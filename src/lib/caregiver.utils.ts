import type { CaregiverLink } from "../types";

type CaregiverRole = "caregiver" | "patient";

type CaregiverLinkWithExpiry = Pick<
  CaregiverLink,
  "id" | "caregiver_id" | "patient_id" | "status" | "created_at" | "expires_at" | "responded_at"
>;

export function getCaregiverLinkState(link: CaregiverLinkWithExpiry, now = new Date()) {
  const expiresAt = link.expires_at ? new Date(link.expires_at) : null;
  const isExpired = link.status === "pending" && !!expiresAt && expiresAt.getTime() <= new Date(now).getTime();
  const effectiveStatus = isExpired ? "expired" : link.status ?? "pending";

  if (effectiveStatus === "accepted") {
    return {
      isExpired: false,
      effectiveStatus,
      statusLabel: "Accepted",
      statusTone: "bg-emerald-100 text-emerald-700",
      helperText: "This caregiver relationship is active.",
    };
  }

  if (effectiveStatus === "declined") {
    return {
      isExpired: false,
      effectiveStatus,
      statusLabel: "Declined",
      statusTone: "bg-rose-100 text-rose-700",
      helperText: "This request was declined and can be resent by the caregiver.",
    };
  }

  if (effectiveStatus === "expired") {
    return {
      isExpired: true,
      effectiveStatus,
      statusLabel: "Expired",
      statusTone: "bg-slate-200 text-slate-700",
      helperText: "This request expired before the patient responded.",
    };
  }

  return {
    isExpired: false,
    effectiveStatus,
    statusLabel: "Pending",
    statusTone: "bg-amber-100 text-amber-700",
    helperText: expiresAt
      ? `Awaiting response until ${expiresAt.toLocaleDateString()}.`
      : "Awaiting patient response.",
  };
}

export function getCaregiverManagementActions(
  link: CaregiverLinkWithExpiry,
  role: CaregiverRole,
  now = new Date(),
) {
  const state = getCaregiverLinkState(link, now);

  return {
    canRespond: role === "patient" && state.effectiveStatus === "pending",
    canResend: role === "caregiver" && (state.effectiveStatus === "expired" || state.effectiveStatus === "declined"),
    canRemove: role === "caregiver" || role === "patient",
  };
}
