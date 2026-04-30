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
// SECURITY: review this — `claude-3-5-sonnet-latest` was retired by Anthropic on
// October 28, 2025. Using a retired alias causes every parse request to fail
// upstream with `model_not_found`. `claude-sonnet-4-6` is Anthropic's
// recommended replacement for the 3.5 Sonnet line and supports vision input.
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const RATE_LIMIT_MAX_REQUESTS = 8;
const FUNCTION_NAME = "parse-prescription";

// SECURITY: review this — Edge Function CORS allowlist. The browser blocks the
// preflight OPTIONS request unless the response carries Access-Control-Allow-*
// headers, so without these the React app on pillybot.vercel.app cannot call
// this function at all. We echo the request Origin only when it matches the
// allowlist below; any other origin gets the canonical pillybot.vercel.app
// host so we never advertise wildcard access.
const ALLOWED_ORIGINS = new Set<string>([
  "https://pillybot.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
]);
const DEFAULT_ALLOWED_ORIGIN = "https://pillybot.vercel.app";

function pickAllowedOrigin(request: Request): string {
  const origin = request.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return origin;
  }
  return DEFAULT_ALLOWED_ORIGIN;
}

function corsHeaders(request: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": pickAllowedOrigin(request),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function buildJsonResponse(
  request: Request,
  status: number,
  body: Record<string, unknown>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
    },
  });
}

function buildErrorResponse(
  request: Request,
  status: number,
  code: string,
  message: string,
) {
  return buildJsonResponse(request, status, {
    error: { code, message },
  });
}

async function insertFunctionEvent(
  adminClient: ReturnType<typeof createClient>,
  payload: {
    eventType: string;
    status: "success" | "warning" | "failure";
    userId?: string | null;
    details?: Record<string, unknown>;
  },
) {
  const { error } = await adminClient.from("edge_function_events").insert({
    function_name: FUNCTION_NAME,
    event_type: payload.eventType,
    status: payload.status,
    user_id: payload.userId ?? null,
    details: payload.details ?? {},
  });

  if (error) {
    console.error("Failed to write edge function event", error);
  }
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
  // Bind the request once so every helper below carries the right CORS
  // headers without each call site having to thread `request` through.
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    buildJsonResponse(request, status, body);
  const errorResponse = (status: number, code: string, message: string) =>
    buildErrorResponse(request, status, code, message);

  if (request.method === "OPTIONS") {
    // Browser preflight. 204 + empty body is the canonical answer; the
    // CORS headers are added by buildJsonResponse via corsHeaders().
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }

  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Method not allowed");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anthropicApiKey) {
    return errorResponse(500, "server_misconfigured", "Server configuration is incomplete");
  }

  const token = getBearerToken(request);
  if (!token) {
    return errorResponse(401, "unauthorized", "Missing or invalid Authorization header");
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
    return errorResponse(401, "unauthorized", "Invalid or expired token");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON");
  }

  if (!isValidRequestBody(body)) {
    return errorResponse(400, "invalid_body", "Body must include imagePath");
  }

  const { data: isAllowed, error: rateLimitError } = await adminClient.rpc("enforce_edge_rate_limit", {
    p_user_id: user.id,
    p_function_name: FUNCTION_NAME,
    p_limit: RATE_LIMIT_MAX_REQUESTS,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });

  if (rateLimitError) {
    await insertFunctionEvent(adminClient, {
      eventType: "rate_limit_error",
      status: "failure",
      userId: user.id,
      details: { message: rateLimitError.message },
    });
    return errorResponse(500, "rate_limit_failed", "Failed to validate request rate limit");
  }

  if (isAllowed !== true) {
    await insertFunctionEvent(adminClient, {
      eventType: "rate_limit_hit",
      status: "warning",
      userId: user.id,
      details: {
        limit: RATE_LIMIT_MAX_REQUESTS,
        window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      },
    });
    return errorResponse(429, "rate_limited", "Too many parse requests. Please try again shortly.");
  }

  const normalizedImagePath = normalizeStoragePath(body.imagePath);
  if (!normalizedImagePath || !isAuthorizedImagePath(normalizedImagePath, user.id)) {
    return errorResponse(403, "forbidden_path", "imagePath is outside the caller's allowed storage path");
  }

  const { folder, fileName } = splitParentPath(normalizedImagePath);
  const { data: listedObjects, error: listError } = await adminClient.storage
    .from(PRESCRIPTION_TEMP_BUCKET)
    .list(folder, {
      limit: 100,
      search: fileName,
    });

  if (listError) {
    await insertFunctionEvent(adminClient, {
      eventType: "parse_failure",
      status: "failure",
      userId: user.id,
      details: { code: "storage_metadata_failed", message: listError.message },
    });
    return errorResponse(500, "storage_metadata_failed", "Failed to inspect image metadata");
  }

  const objectRow = listedObjects?.find((item) => item.name === fileName) ?? null;
  if (!objectRow) {
    return errorResponse(404, "image_not_found", "Image not found");
  }

  const objectSize = Number((objectRow.metadata as Record<string, unknown> | undefined)?.size);
  if (!Number.isFinite(objectSize) || objectSize <= 0) {
    return errorResponse(400, "invalid_image_metadata", "Image metadata is invalid");
  }

  if (objectSize > MAX_IMAGE_BYTES) {
    return errorResponse(413, "image_too_large", "Image exceeds the 5MB limit");
  }

  const { data: imageBlob, error: downloadError } = await adminClient.storage
    .from(PRESCRIPTION_TEMP_BUCKET)
    .download(normalizedImagePath);

  if (downloadError || !imageBlob) {
    await insertFunctionEvent(adminClient, {
      eventType: "parse_failure",
      status: "failure",
      userId: user.id,
      details: { code: "image_not_found", message: downloadError?.message ?? "Image blob was empty" },
    });
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
    await insertFunctionEvent(adminClient, {
      eventType: "parse_failure",
      status: "failure",
      userId: user.id,
      details: { code: "upstream_unavailable" },
    });
    return errorResponse(502, "upstream_unavailable", "Failed to reach Anthropic API");
  }

  let anthropicResponseJson: Record<string, unknown>;
  try {
    anthropicResponseJson = await anthropicApiResponse.json();
  } catch {
    return errorResponse(502, "upstream_invalid_response", "Anthropic returned a non-JSON response");
  }

  if (!anthropicApiResponse.ok) {
    const upstreamError = anthropicResponseJson?.error as Record<string, unknown> | undefined;
    await insertFunctionEvent(adminClient, {
      eventType: "parse_failure",
      status: "failure",
      userId: user.id,
      details: {
        code: "upstream_request_failed",
        upstream_status: anthropicApiResponse.status,
        upstream_error_type: typeof upstreamError?.type === "string" ? upstreamError.type : null,
        model: ANTHROPIC_MODEL,
        response: anthropicResponseJson,
      },
    });
    return errorResponse(502, "upstream_request_failed", "Anthropic request failed");
  }

  const completionText = extractModelText(anthropicResponseJson);
  if (!completionText) {
    return errorResponse(502, "upstream_missing_content", "Anthropic response did not include a parsing result");
  }

  let parsedPrescription: ParsedPrescriptionResult;
  try {
    parsedPrescription = parseModelResponse(completionText);
  } catch {
    await insertFunctionEvent(adminClient, {
      eventType: "parse_failure",
      status: "failure",
      userId: user.id,
      details: { code: "upstream_invalid_payload" },
    });
    return errorResponse(502, "upstream_invalid_payload", "Failed to validate model parsing JSON");
  }

  const { error: deleteError } = await adminClient.storage
    .from(PRESCRIPTION_TEMP_BUCKET)
    .remove([normalizedImagePath]);

  if (deleteError) {
    console.error("Failed to remove temporary prescription image", deleteError);
  }

  return jsonResponse(200, parsedPrescription);
});
