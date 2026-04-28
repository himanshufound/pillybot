import { describe, expect, it } from "vitest";
import { getCaregiverLinkState, getCaregiverManagementActions } from "./caregiver.utils";

const now = "2026-04-28T12:00:00.000Z";

describe("getCaregiverLinkState", () => {
  it("marks pending links as expired when the expiry date has passed", () => {
    const state = getCaregiverLinkState(
      {
        id: "link-1",
        caregiver_id: "caregiver-1",
        patient_id: "patient-1",
        status: "pending",
        created_at: "2026-04-20T12:00:00.000Z",
        expires_at: "2026-04-27T12:00:00.000Z",
      },
      now,
    );

    expect(state.isExpired).toBe(true);
    expect(state.statusLabel).toBe("Expired");
    expect(state.statusTone).toContain("bg-slate-200");
  });
});

describe("getCaregiverManagementActions", () => {
  it("allows caregivers to resend and remove expired requests", () => {
    const actions = getCaregiverManagementActions(
      {
        id: "link-1",
        caregiver_id: "caregiver-1",
        patient_id: "patient-1",
        status: "pending",
        created_at: "2026-04-20T12:00:00.000Z",
        expires_at: "2026-04-27T12:00:00.000Z",
      },
      "caregiver",
      now,
    );

    expect(actions.canResend).toBe(true);
    expect(actions.canRemove).toBe(true);
    expect(actions.canRespond).toBe(false);
  });

  it("allows patients to accept or decline active requests", () => {
    const actions = getCaregiverManagementActions(
      {
        id: "link-2",
        caregiver_id: "caregiver-1",
        patient_id: "patient-1",
        status: "pending",
        created_at: "2026-04-28T08:00:00.000Z",
        expires_at: "2026-05-05T08:00:00.000Z",
      },
      "patient",
      now,
    );

    expect(actions.canRespond).toBe(true);
    expect(actions.canResend).toBe(false);
    expect(actions.canRemove).toBe(true);
  });
});
