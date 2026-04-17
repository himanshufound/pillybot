import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PILL_IMAGES_BUCKET = "pill-images";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token, ...rest] = authorization.trim().split(/\s+/);
  if (scheme !== "Bearer" || !token || rest.length > 0) {
    return null;
  }

  return token;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function isValidRequestBody(body: unknown): body is VerifyPillRequest {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as Record<string, unknown>;

  if (typeof candidate.imagePath !== "string" || candidate.imagePath.trim().length === 0) {
    return false;
  }

  if (typeof candidate.medicationId !== "string" || !isUuid(candidate.medicationId)) {
    return false;
  }

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
      if (next === decoded) {
        return decoded;
      }

      decoded = next;
    } catch {
      return null;
    }
  }

  return decoded;
}

function normalizeStoragePath(rawPath: string): string | null {
  const decoded = decodePathSafely(rawPath);
  if (!decoded) {
    return null;
  }

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

  if (segments.length < 3) {
    return null;
  }

  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }

  return segments.join("/");
}

function isAuthorizedImagePath(path: string, userId: string): boolean {
  const segments = path.split("/");
  return segments[0] === "users" && segments[1] === userId && segments.length >= 3;
}

function splitParentPath(path: string): { folder: string; fileName: string } {
  const segments = path.split("/");
  const fileName = segments[segments.length - 1];
  const folder = segments.slice(0, -1).join("/");
  return { folder, fileName };
}

function getObjectSizeBytes(metadata: Record<string, unknown> | null | undefined): number | null {
  const size = metadata?.size;
  const parsed = Number(size);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getAllowedMimeType(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

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
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function extractCandidateText(geminiResponse: Record<string, unknown>): string | null {
  const candidates = geminiResponse.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const firstCandidate = candidates[0];
  if (!firstCandidate || typeof firstCandidate !== "object") {
    return null;
  }

  const content = (firstCandidate as Record<string, unknown>).content;
  if (!content || typeof content !== "object") {
    return null;
  }

  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const text = (part as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
  }

  return null;
}

function parseGeminiResponse(text: string): VerificationResult {
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
    throw new Error("Gemini response did not match the expected schema");
  }

  if (!Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error("Gemini confidence must be between 0 and 1");
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

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  if (!supabaseUrl || !serviceRoleKey || !geminiApiKey) {
    return jsonResponse(500, { error: "Server is missing required configuration" });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const token = getBearerToken(request);
  if (!token) {
    return jsonResponse(401, { error: "Missing or invalid Authorization header" });
  }

  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(token);

  if (authError || !user) {
    return jsonResponse(401, { error: "Invalid or expired token" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Request body must be valid JSON" });
  }

  if (!isValidRequestBody(body)) {
    return jsonResponse(400, {
      error: "Body must include imagePath and medicationId, with optional doseLogId",
    });
  }

  const normalizedImagePath = normalizeStoragePath(body.imagePath);
  if (!normalizedImagePath || !isAuthorizedImagePath(normalizedImagePath, user.id)) {
    return jsonResponse(403, { error: "imagePath is outside the caller's allowed storage path" });
  }

  const { medicationId, doseLogId } = body;

  const { data: medication, error: medicationError } = await adminClient
    .from("medications")
    .select("id, user_id, name, dosage, instructions, schedule, active")
    .eq("id", medicationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (medicationError) {
    return jsonResponse(500, { error: "Failed to load medication" });
  }

  if (!medication) {
    return jsonResponse(404, { error: "Medication not found" });
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
      return jsonResponse(500, { error: "Failed to load dose log" });
    }

    if (!doseLog) {
      return jsonResponse(403, { error: "Dose log does not belong to this user and medication" });
    }
  }

  const { folder, fileName } = splitParentPath(normalizedImagePath);
  const { data: listedObjects, error: listError } = await adminClient.storage
    .from(PILL_IMAGES_BUCKET)
    .list(folder, {
      limit: 100,
      search: fileName,
    });

  if (listError) {
    return jsonResponse(500, { error: "Failed to inspect image metadata" });
  }

  const objectRow = listedObjects?.find((item) => item.name === fileName) ?? null;
  if (!objectRow) {
    return jsonResponse(404, { error: "Image not found" });
  }

  const objectSize = getObjectSizeBytes(
    objectRow.metadata && typeof objectRow.metadata === "object"
      ? objectRow.metadata as Record<string, unknown>
      : null,
  );
  if (!objectSize) {
    return jsonResponse(400, { error: "Image metadata is invalid" });
  }

  if (objectSize > MAX_IMAGE_BYTES) {
    return jsonResponse(413, { error: "Image exceeds the 5MB limit" });
  }

  const { data: imageBlob, error: downloadError } = await adminClient.storage
    .from(PILL_IMAGES_BUCKET)
    .download(normalizedImagePath);

  if (downloadError || !imageBlob) {
    return jsonResponse(404, { error: "Image not found" });
  }

  if (imageBlob.size > MAX_IMAGE_BYTES) {
    return jsonResponse(413, { error: "Image exceeds the 5MB limit" });
  }

  let imageBytes: Uint8Array;
  try {
    imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
  } catch {
    return jsonResponse(500, { error: "Failed to read image bytes" });
  }

  if (imageBytes.length === 0) {
    return jsonResponse(400, { error: "Image file is empty" });
  }

  if (imageBytes.length > MAX_IMAGE_BYTES) {
    return jsonResponse(413, { error: "Image exceeds the 5MB limit" });
  }

  const mimeType = getAllowedMimeType(imageBytes);
  if (!mimeType) {
    return jsonResponse(400, { error: "Only JPEG and PNG images are allowed" });
  }

  const imageBase64 = toBase64(imageBytes);

  const geminiPayload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "You are verifying whether an uploaded pill image matches the user's medication. " +
              "Respond with JSON only using this exact schema: " +
              '{"verified":boolean,"confidence":number,"description":string,"concerns":string[],"safe_to_take":boolean,"message":string}.' +
              ` Medication name: ${medication.name}.` +
              ` Dosage: ${medication.dosage}.` +
              ` Instructions: ${medication.instructions ?? "N/A"}.` +
              ` Schedule: ${medication.schedule ?? "N/A"}.` +
              " Use a confidence between 0 and 1. Do not include markdown fences or extra keys.",
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: "application/json",
    },
  };

  let geminiApiResponse: Response;
  try {
    geminiApiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiApiKey,
        },
        body: JSON.stringify(geminiPayload),
      },
    );
  } catch {
    return jsonResponse(502, { error: "Failed to reach Gemini API" });
  }

  let geminiResponseJson: Record<string, unknown>;
  try {
    geminiResponseJson = await geminiApiResponse.json();
  } catch {
    return jsonResponse(502, { error: "Gemini returned a non-JSON response" });
  }

  if (!geminiApiResponse.ok) {
    return jsonResponse(502, { error: "Gemini request failed" });
  }

  const candidateText = extractCandidateText(geminiResponseJson);
  if (!candidateText) {
    return jsonResponse(502, { error: "Gemini response did not include a verification result" });
  }

  let verificationResult: VerificationResult;
  try {
    verificationResult = parseGeminiResponse(candidateText);
  } catch {
    return jsonResponse(502, { error: "Failed to validate Gemini verification JSON" });
  }

  if (doseLogId) {
    const { error: updateError } = await adminClient
      .from("dose_logs")
      .update({
        verification_result: verificationResult,
      })
      .eq("id", doseLogId)
      .eq("user_id", user.id)
      .eq("medication_id", medicationId);

    if (updateError) {
      return jsonResponse(500, { error: "Failed to update dose log verification result" });
    }
  }

  return jsonResponse(200, {
    verificationResult,
  });
});
