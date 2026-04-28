import { describe, expect, it } from "vitest";
import {
  describeNotificationPermission,
  getPushCapability,
  resolveServiceWorkerPath,
} from "./pushNotifications.utils";

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

describe("getPushCapability", () => {
  it("returns unsupported when required browser features are missing", () => {
    expect(
      getPushCapability({
        hasNotification: false,
        hasPushManager: true,
        hasServiceWorker: true,
      }),
    ).toBe("unsupported");
  });

  it("returns ready when every required feature is present", () => {
    expect(
      getPushCapability({
        hasNotification: true,
        hasPushManager: true,
        hasServiceWorker: true,
      }),
    ).toBe("ready");
  });
});

describe("describeNotificationPermission", () => {
  it("maps browser permission to user-facing labels", () => {
    expect(describeNotificationPermission("default")).toMatchObject({
      label: "Permission needed",
      canRequest: true,
    });
    expect(describeNotificationPermission("denied")).toMatchObject({
      label: "Blocked",
      canRequest: false,
    });
  });
});
