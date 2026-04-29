import { FormEvent, useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { Loader } from "../components/Loader";
import { Notice } from "../components/Notice";
import { useAuth } from "../lib/auth";
import { getCaregiverLinkState, getCaregiverManagementActions } from "../lib/caregiver.utils";
import { computeAdherenceByPatient } from "../lib/dashboard.utils";
import { supabase } from "../lib/supabase";
import type { CaregiverLink, DoseLog, Profile } from "../types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PatientSummary = {
  adherence: number | null;
  link: CaregiverLink;
  role: "caregiver" | "patient";
};

type RelationshipRecord = {
  caregiver: Profile | Profile[] | null;
  caregiver_id: string;
  created_at: string;
  id: string;
  patient: Profile | Profile[] | null;
  patient_id: string;
  status?: "pending" | "accepted" | "declined";
};

function normalizeProfile(profile: Profile | Profile[] | null | undefined) {
  if (Array.isArray(profile)) {
    return profile[0] ?? null;
  }

  return profile ?? null;
}

function statusTone(status: string) {
  if (status === "accepted") return "bg-emerald-100 text-emerald-700";
  if (status === "declined") return "bg-rose-100 text-rose-700";
  if (status === "expired") return "bg-slate-200 text-slate-700";
  return "bg-amber-100 text-amber-700";
}

export default function CaregiverPage() {
  const { user } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [relationships, setRelationships] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadRelationships() {
    if (!user) return;
    const userId = user.id;
    setLoading(true);
    setError("");

    try {
      const { data: links, error: linkError } = await supabase
        .from("caregiver_links")
        .select(
          "id, caregiver_id, patient_id, status, created_at, expires_at, responded_at, caregiver:profiles!caregiver_links_caregiver_id_fkey(id, email, full_name, avatar_url, timezone), patient:profiles!caregiver_links_patient_id_fkey(id, email, full_name, avatar_url, timezone)",
        )
        .or(`caregiver_id.eq.${userId},patient_id.eq.${userId}`);

      if (linkError) throw linkError;

      const safeLinks = ((links ?? []) as RelationshipRecord[]).map((link) => {
        const normalized = {
          ...link,
          caregiver: normalizeProfile(link.caregiver),
          patient: normalizeProfile(link.patient),
        } as CaregiverLink;

        return normalized;
      });

      const since = new Date();
      since.setDate(since.getDate() - 7);

      const acceptedPatientIds = Array.from(
        new Set(
          safeLinks
            .filter((link) => link.caregiver_id === userId && link.status === "accepted")
            .map((link) => link.patient_id),
        ),
      );

      let adherenceByPatient = new Map<string, number>();

      if (acceptedPatientIds.length > 0) {
        const { data: doseRows, error: doseError } = await supabase
          .from("dose_logs")
          .select("user_id, status")
          .in("user_id", acceptedPatientIds)
          .gte("scheduled_at", since.toISOString());

        if (doseError) throw doseError;

        adherenceByPatient = computeAdherenceByPatient(
          (doseRows ?? []) as Pick<DoseLog, "user_id" | "status">[],
          acceptedPatientIds,
        );
      }

      const summaries: PatientSummary[] = safeLinks.map((link) => {
        const role: PatientSummary["role"] = link.caregiver_id === userId ? "caregiver" : "patient";
        const adherence = role === "caregiver" && link.status === "accepted"
          ? adherenceByPatient.get(link.patient_id) ?? 0
          : null;

        return { adherence, link, role };
      });

      setRelationships(summaries);
    } catch {
      setError("We could not load caregiver links.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRelationships();
  }, [user]);

  async function resolvePatientId(value: string) {
    const trimmed = value.trim();

    if (UUID_PATTERN.test(trimmed)) {
      return trimmed;
    }

    if (!trimmed.includes("@")) {
      throw new Error("Enter a patient email or profile ID.");
    }

    const { data, error: profileError } = await supabase.rpc("find_profile_id_by_email", {
      p_email: trimmed,
    });

    if (profileError) {
      if (profileError.code === "54000" || /rate limit/i.test(profileError.message)) {
        throw new Error("Too many lookups in a short window. Please wait and try again.");
      }
      throw new Error("We could not find a patient profile for that email.");
    }

    if (!data) {
      throw new Error("We could not find a patient profile for that email.");
    }

    return data as string;
  }

  async function handleLink(event: FormEvent) {
    event.preventDefault();
    if (!user) return;

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const patientId = await resolvePatientId(identifier.trim());
      if (patientId === user.id) {
        throw new Error("You cannot link yourself as your own patient.");
      }

      const nowIso = new Date().toISOString();
      const expiresAtIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: existingLink, error: existingLinkError } = await supabase
        .from("caregiver_links")
        .select("id, status")
        .eq("caregiver_id", user.id)
        .eq("patient_id", patientId)
        .maybeSingle();

      if (existingLinkError) throw existingLinkError;

      if (existingLink?.status === "accepted") {
        throw new Error("This caregiver relationship is already active.");
      }

      if (existingLink?.id) {
        const { error: updateError, count: updateCount } = await supabase
          .from("caregiver_links")
          .update(
            {
              status: "pending",
              created_at: nowIso,
              expires_at: expiresAtIso,
              responded_at: null,
            },
            { count: "exact" },
          )
          .eq("id", existingLink.id)
          .eq("caregiver_id", user.id);

        if (updateError) throw updateError;
        if (updateCount === 0) {
          throw new Error("This caregiver request could not be updated. You may not have permission.");
        }
      } else {
        const { error: insertError } = await supabase.from("caregiver_links").insert({
          caregiver_id: user.id,
          patient_id: patientId,
          status: "pending",
          expires_at: expiresAtIso,
        });

        if (insertError) throw insertError;
      }

      setIdentifier("");
      setMessage("Caregiver link requested. The patient has 7 days to respond.");
      await loadRelationships();
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "We could not create that caregiver link.");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(linkId: string, status: "accepted" | "declined") {
    if (!user) return;

    setUpdatingId(linkId);
    setError("");
    setMessage("");

    try {
      const existingLink = relationships.find((entry) => entry.link.id === linkId)?.link;
      const state = existingLink ? getCaregiverLinkState(existingLink) : null;
      if (state?.isExpired) {
        throw new Error("This request has expired. Ask the caregiver to resend it.");
      }

      const { error: updateError, count: updateCount } = await supabase
        .from("caregiver_links")
        .update(
          { status, responded_at: new Date().toISOString() },
          { count: "exact" },
        )
        .eq("id", linkId)
        .eq("patient_id", user.id);

      if (updateError) throw updateError;
      if (updateCount === 0) {
        throw new Error("We could not update this request. It may have been removed or you do not have permission.");
      }

      setMessage(status === "accepted" ? "Caregiver link accepted." : "Caregiver link declined.");
      await loadRelationships();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "We could not update that caregiver link.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function resendLink(linkId: string) {
    if (!user) return;

    setUpdatingId(linkId);
    setError("");
    setMessage("");

    try {
      const expiresAtIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error: updateError, count: updateCount } = await supabase
        .from("caregiver_links")
        .update(
          {
            status: "pending",
            created_at: new Date().toISOString(),
            expires_at: expiresAtIso,
            responded_at: null,
          },
          { count: "exact" },
        )
        .eq("id", linkId)
        .eq("caregiver_id", user.id);

      if (updateError) throw updateError;
      if (updateCount === 0) {
        throw new Error("We could not resend this request. It may have been removed or you do not have permission.");
      }

      setMessage("Caregiver request resent. The patient has 7 days to respond.");
      await loadRelationships();
    } catch {
      setError("We could not resend that caregiver request.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function removeLink(linkId: string) {
    if (!user) return;

    setUpdatingId(linkId);
    setError("");
    setMessage("");

    try {
      const { error: deleteError, count: deleteCount } = await supabase
        .from("caregiver_links")
        .delete({ count: "exact" })
        .eq("id", linkId)
        .or(`caregiver_id.eq.${user.id},patient_id.eq.${user.id}`);

      if (deleteError) throw deleteError;
      if (deleteCount === 0) {
        throw new Error("We could not remove this link. It may have already been removed.");
      }

      setMessage("Caregiver link removed.");
      await loadRelationships();
    } catch {
      setError("We could not remove that caregiver link.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="page-motion grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <section>
        <p className="text-sm font-black uppercase tracking-[0.22em] text-teal-700">Caregiver</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">
          Manage trusted care relationships.
        </h1>
        <p className="mt-4 text-slate-600">
          Create caregiver links, review incoming requests, and accept or decline them securely as the patient.
        </p>
      </section>

      <section className="grid gap-4">
        <Card>
          <form className="grid gap-4" onSubmit={handleLink}>
            {error ? <Notice type="error">{error}</Notice> : null}
            {message ? <Notice type="success">{message}</Notice> : null}
            <Input
              label="Patient email or profile ID"
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="patient@example.com or UUID"
              value={identifier}
            />
            <Button disabled={submitting || updatingId !== null} type="submit">
              {submitting ? "Linking..." : "Request link"}
            </Button>
          </form>
        </Card>

        {loading ? <Loader label="Loading care relationships" /> : null}
        {!loading && relationships.length === 0 ? <Card>No caregiver links yet.</Card> : null}

        {relationships.map(({ adherence, link, role }) => {
          const isPatient = role === "patient";
          const state = getCaregiverLinkState(link);
          const actions = getCaregiverManagementActions(link, role);
          const displayName = isPatient
            ? link.caregiver?.full_name ?? "Caregiver"
            : link.patient?.full_name ?? "Linked patient";

          return (
            <Card className="grid gap-4" key={link.id}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                    {isPatient ? "Incoming caregiver request" : "Patient link"}
                  </p>
                  <h2 className="mt-1 text-xl font-black text-slate-950">{displayName}</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    Created {new Date(link.created_at).toLocaleDateString()}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{state.helperText}</p>
                </div>

                <div className="flex flex-col items-start gap-3 sm:items-end">
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${statusTone(state.effectiveStatus)}`}>
                    {state.statusLabel}
                  </span>
                  {role === "caregiver" && adherence !== null ? (
                    <div className="text-right">
                      <p className="text-3xl font-black text-teal-600">{adherence}%</p>
                      <p className="text-xs font-black uppercase tracking-wider text-slate-400">7-day adherence</p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {actions.canRespond ? (
                  <>
                    <Button
                      disabled={updatingId === link.id}
                      onClick={() => updateStatus(link.id, "accepted")}
                      type="button"
                    >
                      {updatingId === link.id ? "Updating..." : "Accept"}
                    </Button>
                    <Button
                      disabled={updatingId === link.id}
                      onClick={() => updateStatus(link.id, "declined")}
                      type="button"
                      variant="secondary"
                    >
                      {updatingId === link.id ? "Updating..." : "Decline"}
                    </Button>
                  </>
                ) : null}

                {actions.canResend ? (
                  <Button
                    disabled={updatingId === link.id}
                    onClick={() => resendLink(link.id)}
                    type="button"
                  >
                    {updatingId === link.id ? "Updating..." : "Resend"}
                  </Button>
                ) : null}

                {actions.canRemove ? (
                  <Button
                    disabled={updatingId === link.id}
                    onClick={() => removeLink(link.id)}
                    type="button"
                    variant="ghost"
                  >
                    {updatingId === link.id ? "Updating..." : "Remove"}
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
