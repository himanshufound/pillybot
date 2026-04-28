import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { LinkButton } from "../components/Button";
import { Loader } from "../components/Loader";
import { Notice } from "../components/Notice";
import { useAuth } from "../lib/auth";
import { mapDoseLogRow, summarizeDoseLogs } from "../lib/dashboard.utils";
import { supabase } from "../lib/supabase";
import type { DoseLog } from "../types";

function dateRangeForToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function statusTone(status: string) {
  if (status === "taken") return "bg-emerald-100 text-emerald-700";
  if (status === "missed") return "bg-rose-100 text-rose-700";
  if (status === "skipped") return "bg-amber-100 text-amber-700";
  return "bg-sky-100 text-sky-700";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [doseLogs, setDoseLogs] = useState<DoseLog[]>([]);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    const userId = user.id;

    async function loadDashboard() {
      setLoading(true);
      setError("");

      try {
        const { start, end } = dateRangeForToday();
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const [todayResult, streakResult] = await Promise.all([
          supabase
            .from("dose_logs")
            .select("id, user_id, medication_id, scheduled_at, taken_at, status, notes, medications(name, dosage, color, shape)")
            .eq("user_id", userId)
            .gte("scheduled_at", start)
            .lt("scheduled_at", end)
            .order("scheduled_at", { ascending: true }),
          supabase
            .from("dose_logs")
            .select("scheduled_at, status")
            .eq("user_id", userId)
            .gte("scheduled_at", sevenDaysAgo.toISOString()),
        ]);

        if (todayResult.error) throw todayResult.error;
        if (streakResult.error) throw streakResult.error;

        setDoseLogs((todayResult.data ?? []).map((row) => mapDoseLogRow(row as unknown as DoseLog)));

        const cleanDays = new Set<string>();
        for (const row of streakResult.data ?? []) {
          if (row.status === "taken") {
            cleanDays.add(new Date(row.scheduled_at).toDateString());
          }
        }
        setStreak(cleanDays.size);
      } catch {
        setError("We could not load today’s dose schedule.");
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [user]);

  const { upcoming, completed, missed } = summarizeDoseLogs(doseLogs);

  return (
    <div className="page-motion grid gap-6">
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.22em] text-teal-700">Today</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">
            Keep the next dose simple and visible.
          </h1>
        </div>
        <Card className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-3xl font-black text-slate-950">{upcoming.length}</p>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Upcoming</p>
          </div>
          <div>
            <p className="text-3xl font-black text-emerald-600">{completed.length}</p>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Taken</p>
          </div>
          <div>
            <p className="text-3xl font-black text-rose-600">{missed.length}</p>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Missed</p>
          </div>
          <div className="col-span-3 rounded-2xl bg-slate-950 px-4 py-3 text-white">
            <span className="text-sm font-bold">Adherence streak: </span>
            <span className="text-sm">{streak} active day{streak === 1 ? "" : "s"} this week</span>
          </div>
        </Card>
      </section>

      {error ? <Notice type="error">{error}</Notice> : null}
      {loading ? <Loader label="Loading today’s doses" /> : null}

      {!loading && doseLogs.length === 0 ? (
        <Card className="grid gap-4">
          <h2 className="text-2xl font-black text-slate-950">No doses scheduled today</h2>
          <p className="text-slate-600">Add medication times to start building a daily reminder plan.</p>
          <LinkButton className="w-fit" to="/add">Add medication</LinkButton>
        </Card>
      ) : null}

      <div className="grid gap-3">
        {doseLogs.map((dose) => (
          <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" key={dose.id}>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-slate-400">
                {new Date(dose.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
              <h2 className="mt-1 text-xl font-black text-slate-950">
                {dose.medications?.name ?? "Medication"}
              </h2>
              <p className="text-sm font-semibold text-slate-500">{dose.medications?.dosage ?? "Dose scheduled"}</p>
            </div>
            <span className={`w-fit rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${statusTone(dose.status)}`}>
              {dose.status}
            </span>
          </Card>
        ))}
      </div>
    </div>
  );
}
