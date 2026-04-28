import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { Loader } from "../components/Loader";
import { Notice } from "../components/Notice";
import { useAuth } from "../lib/auth";
import { getPushPermissionState, sendTestNotification, subscribePush, unsubscribePush } from "../lib/pushNotifications";
import { supabase } from "../lib/supabase";
import type { Profile } from "../types";

export default function SettingsPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPermission, setPushPermission] = useState(() => getPushPermissionState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user) return;
    const userId = user.id;

    async function loadSettings() {
      setLoading(true);
      setError("");

      try {
        const [profileResult, subscriptionResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, avatar_url, timezone")
            .eq("id", userId)
            .maybeSingle(),
          supabase
            .from("web_push_subscriptions")
            .select("id")
            .eq("user_id", userId)
            .limit(1),
        ]);

        if (profileResult.error) throw profileResult.error;
        if (subscriptionResult.error) throw subscriptionResult.error;

        const nextProfile = profileResult.data as Profile | null;
        setProfile(nextProfile);
        setFullName(nextProfile?.full_name ?? "");
        setPushEnabled((subscriptionResult.data ?? []).length > 0);
        setPushPermission(getPushPermissionState());
      } catch {
        setError("We could not load settings.");
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, [user]);

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim() || null, updated_at: new Date().toISOString() })
        .eq("id", user.id);

      if (updateError) throw updateError;
      setMessage("Profile updated.");
    } catch {
      setError("We could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePush() {
    if (!user) return;
    setSaving(true);
    setError("");
    setMessage("");

    try {
      if (pushEnabled) {
        await unsubscribePush(user.id);
        setPushEnabled(false);
        setMessage("Notifications disabled.");
      } else {
        await subscribePush(user.id);
        setPushEnabled(true);
        setMessage("Notifications enabled.");
      }
      setPushPermission(getPushPermissionState());
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "We could not update notification settings.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshPushSubscription() {
    if (!user) return;
    setSaving(true);
    setError("");
    setMessage("");

    try {
      await subscribePush(user.id, { forceRefresh: true });
      setPushEnabled(true);
      setPushPermission(getPushPermissionState());
      setMessage("Notification subscription refreshed.");
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "We could not refresh this browser subscription.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestNotification() {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      await sendTestNotification();
      setMessage("Test notification sent to this browser.");
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "We could not send a test notification.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-motion grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <section>
        <p className="text-sm font-black uppercase tracking-[0.22em] text-teal-700">Settings</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">Your profile and reminders.</h1>
        <p className="mt-4 text-slate-600">Only browser-safe public keys are used here. Server secrets stay in Edge Functions.</p>
      </section>

      <section className="grid gap-4">
        {loading ? <Loader label="Loading settings" /> : null}
        {error ? <Notice type="error">{error}</Notice> : null}
        {message ? <Notice type="success">{message}</Notice> : null}

        <Card className="grid gap-4">
          <h2 className="text-2xl font-black text-slate-950">Profile</h2>
          <Input label="Full name" onChange={(event) => setFullName(event.target.value)} value={fullName} />
          <p className="text-sm font-semibold text-slate-500">Account: {user?.email}</p>
          <p className="text-sm font-semibold text-slate-500">Timezone: {profile?.timezone ?? "UTC"}</p>
          <Button disabled={saving} onClick={saveProfile} type="button">
            {saving ? "Saving..." : "Save profile"}
          </Button>
        </Card>

        <Card className="grid gap-4">
          <h2 className="text-2xl font-black text-slate-950">Push notifications</h2>
          <p className="text-sm font-semibold text-slate-500">
            Status: <span className="text-slate-950">{pushPermission.label}</span>
          </p>
          <p className="text-slate-600">
            {pushPermission.detail}
          </p>
          <Button disabled={saving || (!pushEnabled && !pushPermission.canRequest)} onClick={togglePush} type="button" variant={pushEnabled ? "danger" : "primary"}>
            {pushEnabled ? "Disable notifications" : "Enable notifications"}
          </Button>
          <div className="flex flex-wrap gap-3">
            <Button disabled={saving || !pushEnabled} onClick={refreshPushSubscription} type="button" variant="secondary">
              Re-register this browser
            </Button>
            <Button disabled={saving || !pushEnabled} onClick={handleTestNotification} type="button" variant="ghost">
              Send test notification
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
