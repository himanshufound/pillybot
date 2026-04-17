import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import webpush from "npm:web-push@3.6.7";

type DoseLogRow = {
  id: string;
  user_id: string;
  medication_id: string;
  scheduled_at: string;
  status: string;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type CaregiverLinkRow = {
  caregiver_id: string;
  patient_id: string;
  status: string;
};

type AlertInsert = {
  user_id: string;
  dose_log_id: string;
  type: "missed_dose";
  title: string;
  message: string;
};

type Counters = {
  processed: number;
  notifications_sent: number;
  alerts_created: number;
  errors: number;
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const REMINDER_PAYLOAD = JSON.stringify({
  title: "Medication Reminder",
  body: "It's time to take your medication",
  url: "/dashboard",
});

const ESCALATION_PAYLOAD = JSON.stringify({
  title: "Missed Dose Alert",
  body: "A linked patient has a dose overdue by 30 minutes",
  url: "/dashboard",
});

const jsonHeaders = {
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: Record<string, number | string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDoseLogRow(value: unknown): value is DoseLogRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    isNonEmptyString(row.id) &&
    isNonEmptyString(row.user_id) &&
    isNonEmptyString(row.medication_id) &&
    isNonEmptyString(row.scheduled_at) &&
    isNonEmptyString(row.status)
  );
}

function isSubscriptionRow(value: unknown): value is SubscriptionRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    isNonEmptyString(row.id) &&
    isNonEmptyString(row.user_id) &&
    isNonEmptyString(row.endpoint) &&
    isNonEmptyString(row.p256dh) &&
    isNonEmptyString(row.auth)
  );
}

function isCaregiverLinkRow(value: unknown): value is CaregiverLinkRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Record<string, unknown>;
  return (
    isNonEmptyString(row.caregiver_id) &&
    isNonEmptyString(row.patient_id) &&
    isNonEmptyString(row.status)
  );
}

function isValidDateString(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function getRequiredEnv(name: string): string | null {
  const value = Deno.env.get(name);
  return isNonEmptyString(value) ? value : null;
}

function increment(target: Counters, field: keyof Counters, value = 1) {
  target[field] += value;
}

async function fetchSubscriptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriptionRow[]> {
  const { data, error } = await supabase
    .from("web_push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error || !Array.isArray(data)) {
    throw new Error("Failed to fetch subscriptions");
  }

  return data.filter(isSubscriptionRow);
}

async function sendPushNotification(
  subscription: SubscriptionRow,
  payload: string,
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      payload,
      {
        TTL: 300,
        urgency: "high",
      },
    );

    return true;
  } catch {
    return false;
  }
}

async function createAlert(
  supabase: SupabaseClient,
  alert: AlertInsert,
): Promise<boolean> {
  const { data: existingAlert, error: existingAlertError } = await supabase
    .from("alerts")
    .select("id")
    .eq("dose_log_id", alert.dose_log_id)
    .eq("type", alert.type)
    .limit(1)
    .maybeSingle();

  if (existingAlertError) {
    throw new Error("Failed to check existing alert");
  }

  if (existingAlert) {
    return false;
  }

  const { error: insertError } = await supabase
    .from("alerts")
    .insert(alert);

  if (insertError) {
    throw new Error("Failed to create alert");
  }

  return true;
}

async function fetchCaregiverIds(
  supabase: SupabaseClient,
  patientId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("caregiver_links")
    .select("caregiver_id, patient_id, status")
    .eq("patient_id", patientId)
    .eq("status", "accepted");

  if (error || !Array.isArray(data)) {
    throw new Error("Failed to fetch caregiver links");
  }

  return data.filter(isCaregiverLinkRow).map((row) => row.caregiver_id);
}

async function fetchPendingDoseLogs(
  supabase: SupabaseClient,
  windowStartIso: string,
  nowIso: string,
): Promise<DoseLogRow[]> {
  const { data, error } = await supabase
    .from("dose_logs")
    .select("id, user_id, medication_id, scheduled_at, status")
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .gte("scheduled_at", windowStartIso);

  if (error || !Array.isArray(data)) {
    throw new Error("Failed to fetch pending dose logs");
  }

  return data.filter(isDoseLogRow).filter((row) => isValidDateString(row.scheduled_at));
}

async function fetchOverdueDoseLogs(
  supabase: SupabaseClient,
  thresholdIso: string,
): Promise<DoseLogRow[]> {
  const { data, error } = await supabase
    .from("dose_logs")
    .select("id, user_id, medication_id, scheduled_at, status")
    .eq("status", "pending")
    .lte("scheduled_at", thresholdIso);

  if (error || !Array.isArray(data)) {
    throw new Error("Failed to fetch overdue dose logs");
  }

  return data.filter(isDoseLogRow).filter((row) => isValidDateString(row.scheduled_at));
}

async function markDoseAsMissed(
  supabase: SupabaseClient,
  doseLogId: string,
): Promise<void> {
  const { error } = await supabase
    .from("dose_logs")
    .update({ status: "missed" })
    .eq("id", doseLogId)
    .eq("status", "pending");

  if (error) {
    throw new Error("Failed to mark dose as missed");
  }
}

async function notifySubscriptions(
  subscriptions: SubscriptionRow[],
  payload: string,
): Promise<number> {
  let sentCount = 0;

  for (const subscription of subscriptions) {
    const sent = await sendPushNotification(subscription, payload);
    if (sent) {
      sentCount += 1;
    }
  }

  return sentCount;
}

async function handleEscalation(
  supabase: SupabaseClient,
  doseLog: DoseLogRow,
  caregiverCache: Map<string, string[]>,
  subscriptionCache: Map<string, SubscriptionRow[]>,
): Promise<{ alertsCreated: number; notificationsSent: number }> {
  const createdAlert = await createAlert(supabase, {
    user_id: doseLog.user_id,
    dose_log_id: doseLog.id,
    type: "missed_dose",
    title: "Medication Alert",
    message: "Dose overdue by 30 minutes",
  });

  if (!createdAlert) {
    return {
      alertsCreated: 0,
      notificationsSent: 0,
    };
  }

  let caregiverIds = caregiverCache.get(doseLog.user_id);
  if (!caregiverIds) {
    caregiverIds = await fetchCaregiverIds(supabase, doseLog.user_id);
    caregiverCache.set(doseLog.user_id, caregiverIds);
  }

  let sentCount = 0;

  for (const caregiverId of caregiverIds) {
    let caregiverSubscriptions = subscriptionCache.get(caregiverId);
    if (!caregiverSubscriptions) {
      caregiverSubscriptions = await fetchSubscriptions(supabase, caregiverId);
      subscriptionCache.set(caregiverId, caregiverSubscriptions);
    }

    sentCount += await notifySubscriptions(caregiverSubscriptions, ESCALATION_PAYLOAD);
  }

  return {
    alertsCreated: 1,
    notificationsSent: sentCount,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (request.headers.has("authorization")) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const cronSecret = getRequiredEnv("CRON_SECRET");
  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPrivateKey = getRequiredEnv("VAPID_PRIVATE_KEY");
  const vapidPublicKey = getRequiredEnv("VAPID_PUBLIC_KEY");

  if (
    !cronSecret ||
    !supabaseUrl ||
    !supabaseServiceRoleKey ||
    !vapidPrivateKey ||
    !vapidPublicKey
  ) {
    return jsonResponse(500, { error: "Server configuration is incomplete" });
  }

  const providedSecret = request.headers.get("x-cron-secret");
  if (!providedSecret || providedSecret !== cronSecret) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  webpush.setVapidDetails(
    "mailto:no-reply@example.com",
    vapidPublicKey,
    vapidPrivateKey,
  );

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - FIVE_MINUTES_MS);
  const thirtyMinutesAgo = new Date(now.getTime() - THIRTY_MINUTES_MS);

  let recentDoseLogs: DoseLogRow[] = [];
  let overdueDoseLogs: DoseLogRow[] = [];

  try {
    recentDoseLogs = await fetchPendingDoseLogs(
      supabase,
      fiveMinutesAgo.toISOString(),
      now.toISOString(),
    );
    overdueDoseLogs = await fetchOverdueDoseLogs(
      supabase,
      thirtyMinutesAgo.toISOString(),
    );
  } catch {
    return jsonResponse(500, { error: "Failed to load reminder data" });
  }

  const counters: Counters = {
    processed: 0,
    notifications_sent: 0,
    alerts_created: 0,
    errors: 0,
  };

  const doseLogMap = new Map<string, DoseLogRow>();
  const caregiverCache = new Map<string, string[]>();
  const subscriptionCache = new Map<string, SubscriptionRow[]>();

  for (const row of recentDoseLogs) {
    doseLogMap.set(row.id, row);
  }
  for (const row of overdueDoseLogs) {
    doseLogMap.set(row.id, row);
  }

  for (const doseLog of doseLogMap.values()) {
    increment(counters, "processed");

    try {
      const scheduledAt = new Date(doseLog.scheduled_at);
      if (Number.isNaN(scheduledAt.getTime())) {
        throw new Error("Invalid scheduled_at");
      }

      const overdueMs = now.getTime() - scheduledAt.getTime();

      if (overdueMs >= TWO_HOURS_MS) {
        const escalationResult = await handleEscalation(
          supabase,
          doseLog,
          caregiverCache,
          subscriptionCache,
        );
        increment(counters, "alerts_created", escalationResult.alertsCreated);
        increment(counters, "notifications_sent", escalationResult.notificationsSent);

        await markDoseAsMissed(supabase, doseLog.id);
        continue;
      }

      if (overdueMs >= THIRTY_MINUTES_MS) {
        const escalationResult = await handleEscalation(
          supabase,
          doseLog,
          caregiverCache,
          subscriptionCache,
        );
        increment(counters, "alerts_created", escalationResult.alertsCreated);
        increment(counters, "notifications_sent", escalationResult.notificationsSent);

        continue;
      }

      let subscriptions = subscriptionCache.get(doseLog.user_id);
      if (!subscriptions) {
        subscriptions = await fetchSubscriptions(supabase, doseLog.user_id);
        subscriptionCache.set(doseLog.user_id, subscriptions);
      }

      if (subscriptions.length === 0) {
        continue;
      }

      const sentCount = await notifySubscriptions(subscriptions, REMINDER_PAYLOAD);
      increment(counters, "notifications_sent", sentCount);
    } catch {
      increment(counters, "errors");
    }
  }

  return new Response(
    JSON.stringify({
      processed: counters.processed,
      notifications_sent: counters.notifications_sent,
      alerts_created: counters.alerts_created,
      errors: counters.errors,
    }),
    {
      status: 200,
      headers: jsonHeaders,
    },
  );
});
