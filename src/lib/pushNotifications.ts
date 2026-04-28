import { supabase } from "./supabase";
import {
  describeNotificationPermission,
  getPushCapability,
  resolveServiceWorkerPath,
  urlBase64ToUint8Array,
} from "./pushNotifications.utils";

function serviceWorkerPath() {
  return resolveServiceWorkerPath(import.meta.env.BASE_URL as string | undefined, window.location.origin);
}

async function getRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }

  const swPath = serviceWorkerPath();
  const existingRegistration = await navigator.serviceWorker.getRegistration(swPath);
  if (existingRegistration) {
    return existingRegistration;
  }

  return navigator.serviceWorker.register(swPath);
}

export function getPushPermissionState() {
  const capability = getPushCapability({
    hasNotification: "Notification" in window,
    hasPushManager: "PushManager" in window,
    hasServiceWorker: "serviceWorker" in navigator,
  });

  if (capability === "unsupported") {
    return describeNotificationPermission("unsupported");
  }

  return describeNotificationPermission(Notification.permission);
}

async function saveSubscription(userId: string, subscription: PushSubscription) {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    throw new Error("Browser returned an incomplete push subscription.");
  }

  const { error } = await supabase.from("web_push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,endpoint" },
  );

  if (error) {
    throw error;
  }
}

export async function subscribePush(userId: string, options?: { forceRefresh?: boolean }) {
  const capability = getPushCapability({
    hasNotification: "Notification" in window,
    hasPushManager: "PushManager" in window,
    hasServiceWorker: "serviceWorker" in navigator,
  });

  if (capability === "unsupported") {
    throw new Error("Push notifications are not supported in this browser.");
  }

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidPublicKey) {
    throw new Error("Push notification public key is not configured.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await getRegistration();
  const existingSubscription = await registration.pushManager.getSubscription();
  if (existingSubscription && !options?.forceRefresh) {
    await saveSubscription(userId, existingSubscription);
    return existingSubscription;
  }

  if (existingSubscription && options?.forceRefresh) {
    await existingSubscription.unsubscribe();
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  await saveSubscription(userId, subscription);
  return subscription;
}

export async function unsubscribePush(userId: string) {
  const registration = await navigator.serviceWorker.getRegistration(serviceWorkerPath());
  const subscription = await registration?.pushManager.getSubscription();

  if (!subscription) {
    return;
  }

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  const { error } = await supabase
    .from("web_push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", endpoint);

  if (error) {
    throw error;
  }
}

export async function sendTestNotification() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    throw new Error("Notifications are not supported in this browser.");
  }

  if (Notification.permission !== "granted") {
    throw new Error("Enable notifications before sending a test alert.");
  }

  const registration = await getRegistration();
  await registration.showNotification("Pillybot test reminder", {
    body: "Notifications are working on this browser.",
    icon: `${import.meta.env.BASE_URL}pwa-icon.svg`,
    badge: `${import.meta.env.BASE_URL}pwa-icon.svg`,
    data: { url: "/" },
  });
}
