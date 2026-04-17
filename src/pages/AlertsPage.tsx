import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Loader } from "../components/Loader";
import { Notice } from "../components/Notice";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import type { Alert } from "../types";

export default function AlertsPage() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAlerts() {
    if (!user) return;
    setLoading(true);
    setError("");

    try {
      const { data, error: fetchError } = await supabase
        .from("alerts")
        .select("id, user_id, type, title, message, read, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;
      setAlerts((data ?? []) as Alert[]);
    } catch {
      setError("We could not load alerts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts();
  }, [user]);

  async function markRead(alertId: string) {
    setError("");
    try {
      const { error: updateError } = await supabase
        .from("alerts")
        .update({ read: true })
        .eq("id", alertId)
        .eq("user_id", user?.id);

      if (updateError) throw updateError;
      setAlerts((current) => current.map((alert) => alert.id === alertId ? { ...alert, read: true } : alert));
    } catch {
      setError("We could not mark that alert as read.");
    }
  }

  return (
    <div className="page-motion grid gap-6">
      <section>
        <p className="text-sm font-black uppercase tracking-[0.22em] text-teal-700">Alerts</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">Signals that need attention.</h1>
      </section>

      {error ? <Notice type="error">{error}</Notice> : null}
      {loading ? <Loader label="Loading alerts" /> : null}

      <div className="grid gap-3">
        {!loading && alerts.length === 0 ? <Card>No alerts yet.</Card> : null}
        {alerts.map((alert) => (
          <Card className={alert.read ? "opacity-70" : "ring-2 ring-amber-200"} key={alert.id}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                  {new Date(alert.created_at).toLocaleString()}
                </p>
                <h2 className="mt-2 text-xl font-black text-slate-950">{alert.title}</h2>
                <p className="mt-1 text-slate-600">{alert.message}</p>
              </div>
              {!alert.read ? (
                <Button onClick={() => markRead(alert.id)} type="button" variant="secondary">
                  Mark read
                </Button>
              ) : (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-wider text-slate-500">
                  Read
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
