import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

type VerifyPillRequest = {
  imagePath: string;
  medicationId: string;
  doseLogId?: string;
};

type VerificationResult = {
  verified: boolean;
  confidence: number;
  description: string;
  concerns: string[];
  safe_to_take: boolean;
  message: string;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PILL_IMAGES_BUCKET = "pill-images";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse(status, {
    error: { code, message },
  });
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return null;

  const [scheme, token, ...rest] = authorization.trim().split(/\s+/);
  if (scheme !== "Bearer" || !token || rest.length > 0) return null;

  return token;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidRequestBody(body: unknown): body is VerifyPillRequest {
  if (!body || typeof body !== "object") return false;

  const candidate = body as Record<string, unknown>;
  if (typeof candidate.imagePath !== "string" || candidate.imagePath.trim().length === 0) return false;
  if (typeof candidate.medicationId !== "string" || !isUuid(candidate.medicationId)) return false;

  if (
    candidate.doseLogId !== undefined &&
    (typeof candidate.doseLogId !== "string" || !isUuid(candidate.doseLogId))
  ) {
    return false;
  }

  return true;
}

function decodePathSafely(rawPath: string): string | null {
  let decoded = rawPath;

  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return null;
    }
  }

  return decoded;
}

function normalizeStoragePath(rawPath: string): string | null {
  const decoded = decodePathSafely(rawPath);
  if (!decoded) return null;

  if (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.includes("%2e") ||
    decoded.includes("%2E")
  ) {
    return null;
  }

  const trimmed = decoded.trim();
  if (trimmed.length === 0 || trimmed.startsWith("/") || trimmed.endsWith("/")) {
    return null;
  }

  const collapsed = trimmed.replace(/\/+/g, "/");
  const segments = collapsed.split("/");
  if (segments.length < 3) return null;
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return null;

  return segments.join("/");
}

function isAuthorizedImagePath(path: string, userId: string): boolean {
  const segments = path.split("/");
  return segments[0] === "users" && segments[1] === userId && segments[2] === "pills" && segments.length >= 4;
}

function splitParentPath(path: string): { folder: string; fileName: string } {
  const segments = path.split("/");
  return {
    folder: segments.slice(0, -1).join("/"),
    fileName: segments[segments.length - 1],
  };
}

function getObjectSizeBytes(metadata: Record<string, unknown> | null | undefined): number | null {
  const parsed = Number(metadata?.size);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getAllowedMimeType(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function extractModelText(modelResponse: Record<string, unknown>): string | null {
  const content = modelResponse.content;
  if (!Array.isArray(content) || content.length === 0) return null;

  for (const part of content) {
    if (!part || typeof part !== "object") continue;

    const candidate = part as Record<string, unknown>;
    if (candidate.type !== "text") continue;

    const text = candidate.text;
    if (typeof text === "string" && text.trim().length > 0) return text;
  }

  return null;
}

function parseModelResponse(text: string): VerificationResult {
  const normalized = text.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  const parsed = JSON.parse(normalized) as Record<string, unknown>;
  if (
    typeof parsed.verified !== "boolean" ||
    typeof parsed.confidence !== "number" ||
    typeof parsed.description !== "string" ||
    !Array.isArray(parsed.concerns) ||
    !parsed.concerns.every((value) => typeof value === "string") ||
    typeof parsed.safe_to_take !== "boolean" ||
    typeof parsed.message !== "string"
  ) {
    throw new Error("Model response did not match the expected schema");
  }

  if (!Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error("Confidence must be between 0 and 1");
  }

  return {
    verified: parsed.verified,
    confidence: parsed.confidence,
    description: parsed.description,
    concerns: parsed.concerns as string[],
    safe_to_take: parsed.safe_to_take,
    message: parsed.message,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Method not allowed");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anthropicApiKey) {
    return errorResponse(500, "server_misconfigured", "Server is missing required configuration");
  }

  const token = getBearerToken(request);
  if (!token) {
    return errorResponse(401, "unauthorized", "Missing or invalid Authorization header");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(token);

  if (authError || !user) {
    return errorResponse(401, "unauthorized", "Invalid or expired token");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON");
  }

  if (!isValidRequestBody(body)) {
    return errorResponse(400, "invalid_body", "Body must include imagePath and medicationId, with optional doseLogId");
  }

  const normalizedImagePath = normalizeStoragePath(body.imagePath);
  if (!normalizedImagePath || !isAuthorizedImagePath(normalizedImagePath, user.id)) {
    return errorResponse(403, "forbidden_path", "imagePath is outside the caller's allowed storage path");
  }

  const { medicationId, doseLogId } = body;

  const { data: medication, error: medicationError } = await adminClient
    .from("medications")
    .select("id, name, dosage, instructions, schedule")
    .eq("id", medicationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (medicationError) {
    return errorResponse(500, "medication_load_failed", "Failed to load medication");
  }

  if (!medication) {
    return errorResponse(404, "medication_not_found", "Medication not found");
  }

  if (doseLogId) {
    const { data: doseLog, error: doseLogError } = await adminClient
      .from("dose_logs")
      .select("id")
      .eq("id", doseLogId)
      .eq("user_id", user.id)
      .eq("medication_id", medicationId)
      .maybeSingle();

    if (doseLogError) {
      return errorResponse(500, "dose_log_load_failed", "Failed to load dose log");
    }

    if (!doseLog) {
      return errorResponse(403, "forbidden_dose_log", "Dose log does not belong to this user and medication");
    }
  }

  const { folder, fileName } = splitParentPath(normalizedImagePath);
  const { data: listedObjects, error: listError } = await adminClient.storage
    .from(PILL_IMAGES_BUCKET)
    .list(folder, { limit: 100, search: fileName });

  if (listError) {
    return errorResponse(500, "storage_metadata_failed", "Failed to inspect image metadata");
  }

  const objectRow = listedObjects?.find((item) => item.name === fileName) ?? null;
  if (!objectRow) {
    return errorResponse(404, "image_not_found", "Image not found");
  }

  const objectSize = getObjectSizeBytes(objectRow.metadata as Record<string, unknown> | null | undefined);
  if (!objectSize) {
    return errorResponse(400, "invalid_image_metadata", "Image metadata is invalid");
  }

  if (objectSize > MAX_IMAGE_BYTES) {
    return errorResponse(413, "image_too_large", "Image exceeds the 5MB limit");
  }

  const { data: imageBlob, error: downloadError } = await adminClient.storage
    .from(PILL_IMAGES_BUCKET)
    .download(normalizedImagePath);

  if (downloadError || !imageBlob) {
    return errorResponse(404, "image_not_found", "Image not found");
  }

  if (imageBlob.size > MAX_IMAGE_BYTES) {
    return errorResponse(413, "image_too_large", "Image exceeds the 5MB limit");
  }

  let imageBytes: Uint8Array;
  try {
    imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
  } catch {
    return errorResponse(500, "image_read_failed", "Failed to read image bytes");
  }

  if (imageBytes.length === 0) {
    return errorResponse(400, "empty_image", "Image file is empty");
  }

  const mimeType = getAllowedMimeType(imageBytes);
  if (!mimeType) {
    return errorResponse(400, "invalid_image_type", "Only JPEG and PNG images are allowed");
  }

  const imageBase64 = toBase64(imageBytes);
  const anthropicPayload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 512,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "You are verifying whether an uploaded pill image matches the user's medication. Respond with JSON only using this exact schema: " +
              '{"verified":boolean,"confidence":number,"description":string,"concerns":string[],"safe_to_take":boolean,"message":string}.' +
              ` Medication name: ${medication.name}.` +
              ` Dosage: ${medication.dosage}.` +
              ` Instructions: ${medication.instructions ?? "N/A"}.` +
              ` Schedule: ${medication.schedule ?? "N/A"}.` +
              " Use a confidence between 0 and 1. Do not include markdown fences or extra keys.",
          },
          {
            type: "image",
            source: { type: "base64", media_type: mimeType, data: imageBase64 },
          },
        ],
      },
    ],
  };

  let anthropicApiResponse: Response;
  try {
    anthropicApiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": anthropicApiKey,
      },
      body: JSON.stringify(anthropicPayload),
    });
  } catch {
    return errorResponse(502, "upstream_unavailable", "Failed to reach Anthropic API");
  }

  let anthropicResponseJson: Record<string, unknown>;
  try {
    anthropicResponseJson = await anthropicApiResponse.json();
  } catch {
    return errorResponse(502, "upstream_invalid_response", "Anthropic returned a non-JSON response");
  }

  if (!anthropicApiResponse.ok) {
    return errorResponse(502, "upstream_request_failed", "Anthropic request failed");
  }

  const completionText = extractModelText(anthropicResponseJson);
  if (!completionText) {
    return errorResponse(502, "upstream_missing_content", "Anthropic response did not include a verification result");
  }

  let verificationResult: VerificationResult;
  try {
    verificationResult = parseModelResponse(completionText);
  } catch {
    return errorResponse(502, "upstream_invalid_payload", "Failed to validate model verification JSON");
  }

  if (doseLogId) {
    const { error: updateError } = await adminClient
      .from("dose_logs")
      .update({ verification_result: verificationResult })
      .eq("id", doseLogId)
      .eq("user_id", user.id)
      .eq("medication_id", medicationId);

    if (updateError) {
      return errorResponse(500, "dose_log_update_failed", "Failed to update dose log verification result");
    }
  }

  return jsonResponse(200, { verificationResult });
});
