import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { Loader } from "../components/Loader";
import { Notice } from "../components/Notice";
import { useAuth } from "../lib/auth";
import { subscribePush, unsubscribePush } from "../lib/pushNotifications";
import { supabase } from "../lib/supabase";
import type { Profile } from "../types";

export default function SettingsPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);
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
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "We could not update notification settings.");
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
          <p className="text-slate-600">
            {pushEnabled ? "This browser is subscribed to reminders." : "Enable reminders on this browser."}
          </p>
          <Button disabled={saving} onClick={togglePush} type="button" variant={pushEnabled ? "danger" : "primary"}>
            {pushEnabled ? "Disable notifications" : "Enable notifications"}
          </Button>
        </Card>
      </section>
    </div>
  );
}
