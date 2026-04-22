const SITE_BUCKET = "site";
const FUNCTION_PREFIXES = ["/functions/v1/static-site", "/static-site"];

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
    pathname.endsWith(".json") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".ico")
  );
}

async function proxyFromBucket(baseUrl: string, pathname: string, request: Request) {
  const upstream = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      Accept: request.headers.get("accept") ?? "*/*",
    },
  });

  if (upstream.status !== 404 || isAssetPath(pathname) || pathname === "/index.html") {
    return upstream;
  }

  return fetch(`${baseUrl}/index.html`, {
    headers: {
      Accept: request.headers.get("accept") ?? "text/html",
    },
  });
}

function toBucketPath(pathname: string): string {
  for (const prefix of FUNCTION_PREFIXES) {
    if (pathname === prefix || pathname === `${prefix}/`) {
      return "/index.html";
    }

    if (pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length);
    }
  }

  return pathname === "/" ? "/index.html" : pathname;
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const baseUrl = publicBucketBaseUrl();
  if (!baseUrl) {
    return new Response("Missing SUPABASE_URL", { status: 500 });
  }

  const url = new URL(request.url);
  const pathname = toBucketPath(url.pathname);
  const upstream = await proxyFromBucket(baseUrl, pathname, request);

  if (request.method === "HEAD") {
    return new Response(null, {
      status: upstream.status,
      headers: upstream.headers,
    });
  }

  return upstream;
});
