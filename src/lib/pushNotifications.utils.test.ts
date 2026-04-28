import { describe, expect, it } from "vitest";
import { resolveServiceWorkerPath } from "./pushNotifications.utils";

describe("resolveServiceWorkerPath", () => {
  it("resolves root base path", () => {
    expect(resolveServiceWorkerPath("/", "https://example.com")).toBe("/sw.js");
  });

  it("resolves nested base path", () => {
    expect(resolveServiceWorkerPath("/app/", "https://example.com")).toBe("/app/sw.js");
  });

  it("normalizes missing trailing slash", () => {
    expect(resolveServiceWorkerPath("/functions/v1/static-site", "https://example.com")).toBe(
      "/functions/v1/static-site/sw.js",
    );
  });
});
