const SITE_BUCKET = "site";
const FUNCTION_PREFIXES = ["/functions/v1/static-site", "/static-site"];

// MIME type mapping for common file extensions
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

function jsonResponse(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function getMimeType(pathname: string): string {
  const ext = pathname.toLowerCase().substring(pathname.lastIndexOf("."));
  return MIME_TYPES[ext] || "application/octet-stream";
}

function publicBucketBaseUrl() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    return null;
  }

  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${SITE_BUCKET}`;
}

function isAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/assets/") ||
    pathname === "/sw.js" ||
    pathname === "/pwa-icon.svg" ||
    pathname === "/favicon.ico" ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".mjs") ||
    pathname.endsWith(".json") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".gif") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".woff") ||
    pathname.endsWith(".woff2") ||
    pathname.endsWith(".ttf") ||
    pathname.endsWith(".eot")
  );
}

async function proxyFromBucket(baseUrl: string, pathname: string, request: Request) {
  const upstream = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      Accept: request.headers.get("accept") ?? "*/*",
    },
  });

  if (upstream.status !== 404 || isAssetPath(pathname) || pathname === "/index.html") {
    // For successful responses, ensure correct MIME type
    if (upstream.ok) {
      const mimeType = getMimeType(pathname);
      const headers = new Headers(upstream.headers);
      headers.set("Content-Type", mimeType);
      
      // Cache static assets aggressively
      if (isAssetPath(pathname)) {
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
      }
      
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }
    return upstream;
  }

  return fetch(`${baseUrl}/index.html`, {
    headers: {
      Accept: request.headers.get("accept") ?? "text/html",
    },
  });
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

function normalizeBucketPath(pathname: string): string | null {
  const decoded = decodePathSafely(pathname);
  if (decoded === null) return null;

  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  if (!decoded.startsWith("/")) return null;

  const collapsed = decoded.replace(/\/+/g, "/");
  const segments = collapsed.split("/").slice(1);

  for (const segment of segments) {
    if (segment === "." || segment === "..") return null;
  }

  return "/" + segments.join("/");
}

function toBucketPath(pathname: string): string | null {
  const safe = normalizeBucketPath(pathname);
  if (safe === null) return null;

  for (const prefix of FUNCTION_PREFIXES) {
    if (safe === prefix || safe === `${prefix}/`) {
      return "/index.html";
    }

    if (safe.startsWith(`${prefix}/`)) {
      return safe.slice(prefix.length) || "/index.html";
    }
  }

  return safe === "/" ? "/index.html" : safe;
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse(405, "method_not_allowed", "Method not allowed");
  }

  const baseUrl = publicBucketBaseUrl();
  if (!baseUrl) {
    return jsonResponse(500, "server_misconfigured", "Missing SUPABASE_URL");
  }

  const url = new URL(request.url);
  const pathname = toBucketPath(url.pathname);
  if (pathname === null) {
    return jsonResponse(400, "invalid_path", "Request path is not allowed");
  }
  const upstream = await proxyFromBucket(baseUrl, pathname, request);

  if (request.method === "HEAD") {
    return new Response(null, {
      status: upstream.status,
      headers: upstream.headers,
    });
  }

  return upstream;
});
