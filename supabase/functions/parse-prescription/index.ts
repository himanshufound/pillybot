import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

type ParsePrescriptionRequest = {
  imagePath: string;
};

type ParsedPrescriptionResult = {
  medication_name: string | null;
  dosage: string | null;
  frequency: string | null;
  times: string[];
  instructions: string | null;
  confidence: number;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PRESCRIPTION_TEMP_BUCKET = "prescription-temp";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
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

function isValidRequestBody(body: unknown): body is ParsePrescriptionRequest {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as Record<string, unknown>;
  return typeof candidate.imagePath === "string" && candidate.imagePath.trim().length > 0 &&
    !candidate.imagePath.includes("\0");
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

  if (decoded.includes("\\") || decoded.includes("\0") || decoded.startsWith("/") || decoded.endsWith("/")) {
    return null;
  }

  const collapsed = decoded.trim().replace(/\/+/g, "/");
  const segments = collapsed.split("/");

  if (
    segments.length < 4 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    return null;
  }

  return segments.join("/");
}

function isAuthorizedImagePath(path: string, userId: string): boolean {
  const segments = path.split("/");
  return segments[0] === "users" && segments[1] === userId && segments[2] === "prescriptions" && segments.length >= 4;
}

function splitParentPath(path: string): { folder: string; fileName: string } {
  const segments = path.split("/");
  const fileName = segments[segments.length - 1];
  const folder = segments.slice(0, -1).join("/");
  return { folder, fileName };
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

function extractModelText(modelResponse: Record<string, unknown>): string | null {
  const content = modelResponse.content;
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }

  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const candidate = part as Record<string, unknown>;
    if (candidate.type !== "text") {
      continue;
    }

    const text = candidate.text;
    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
  }

  return null;
}

function parseModelResponse(text: string): ParsedPrescriptionResult {
  const normalized = text.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  const parsed = JSON.parse(normalized) as Record<string, unknown>;
  const confidence = Number(parsed.confidence);

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Confidence must be between 0 and 1");
  }

  const normalizeText = (value: unknown): string | null => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const times = Array.isArray(parsed.times)
    ? parsed.times.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  return {
    medication_name: normalizeText(parsed.medication_name),
    dosage: normalizeText(parsed.dosage),
    frequency: normalizeText(parsed.frequency),
    times: times.map((time) => time.trim()),
    instructions: normalizeText(parsed.instructions),
    confidence,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anthropicApiKey) {
    return jsonResponse(500, { error: "Server configuration is incomplete" });
  }

  const token = getBearerToken(request);
  if (!token) {
    return jsonResponse(401, { error: "Missing or invalid Authorization header" });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

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
    return jsonResponse(400, { error: "Body must include imagePath" });
  }

  const normalizedImagePath = normalizeStoragePath(body.imagePath);
  if (!normalizedImagePath || !isAuthorizedImagePath(normalizedImagePath, user.id)) {
    return jsonResponse(403, { error: "imagePath is outside the caller's allowed storage path" });
  }

  const { folder, fileName } = splitParentPath(normalizedImagePath);
  const { data: listedObjects, error: listError } = await adminClient.storage
    .from(PRESCRIPTION_TEMP_BUCKET)
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

  const objectSize = Number((objectRow.metadata as Record<string, unknown> | undefined)?.size);
  if (!Number.isFinite(objectSize) || objectSize <= 0) {
    return jsonResponse(400, { error: "Image metadata is invalid" });
  }

  if (objectSize > MAX_IMAGE_BYTES) {
    return jsonResponse(413, { error: "Image exceeds the 5MB limit" });
  }

  const { data: imageBlob, error: downloadError } = await adminClient.storage
    .from(PRESCRIPTION_TEMP_BUCKET)
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

  const mimeType = getAllowedMimeType(imageBytes);
  if (!mimeType) {
    return jsonResponse(400, { error: "Only JPEG and PNG images are allowed" });
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
              "Extract structured data from this prescription image and respond with JSON only using this exact schema: " +
              '{"medication_name":string|null,"dosage":string|null,"frequency":string|null,"times":string[],"instructions":string|null,"confidence":number}.' +
              " If a value is not visible, return null or an empty array. Keep times as human-readable strings.",
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: imageBase64,
            },
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
    return jsonResponse(502, { error: "Failed to reach Anthropic API" });
  }

  let anthropicResponseJson: Record<string, unknown>;
  try {
    anthropicResponseJson = await anthropicApiResponse.json();
  } catch {
    return jsonResponse(502, { error: "Anthropic returned a non-JSON response" });
  }

  if (!anthropicApiResponse.ok) {
    return jsonResponse(502, { error: "Anthropic request failed" });
  }

  const completionText = extractModelText(anthropicResponseJson);
  if (!completionText) {
    return jsonResponse(502, { error: "Anthropic response did not include a parsing result" });
  }

  let parsedPrescription: ParsedPrescriptionResult;
  try {
    parsedPrescription = parseModelResponse(completionText);
  } catch {
    return jsonResponse(502, { error: "Failed to validate model parsing JSON" });
  }

  const { error: deleteError } = await adminClient.storage
    .from(PRESCRIPTION_TEMP_BUCKET)
    .remove([normalizedImagePath]);

  if (deleteError) {
    console.error("Failed to remove temporary prescription image", deleteError);
  }

  return jsonResponse(200, parsedPrescription);
});
