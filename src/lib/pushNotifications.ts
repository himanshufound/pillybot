import { supabase } from "./supabase";
import { resolveServiceWorkerPath, urlBase64ToUint8Array } from "./pushNotifications.utils";

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

export async function subscribePush(userId: string) {
  if (!("Notification" in window) || !("PushManager" in window)) {
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
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

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
