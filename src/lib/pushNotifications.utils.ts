export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

export function resolveServiceWorkerPath(baseUrl: string | undefined, origin: string) {
  const normalizedBase = baseUrl && baseUrl.length > 0
    ? (baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
    : "/";

  return new URL("sw.js", `${origin}${normalizedBase}`).pathname;
}
