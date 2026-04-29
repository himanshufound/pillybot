import { describe, expect, it } from "vitest";
import {
  computeAdherenceByPatient,
  countTakenDays,
  mapDoseLogRow,
  summarizeDoseLogs,
} from "./dashboard.utils";

describe("mapDoseLogRow", () => {
  it("normalizes nested medication rows", () => {
    expect(
      mapDoseLogRow({
        id: "dose-1",
        user_id: "user-1",
        medication_id: "med-1",
        scheduled_at: "2026-04-28T08:00:00.000Z",
        taken_at: null,
        status: "scheduled",
        notes: null,
        medications: [{ name: "Aspirin", dosage: "100mg", color: "white", shape: "round" }],
      }),
    ).toMatchObject({
      id: "dose-1",
      status: "scheduled",
      medications: { name: "Aspirin", dosage: "100mg", color: "white", shape: "round" },
    });
  });
});

describe("summarizeDoseLogs", () => {
  it("groups scheduled, taken, and missed doses and counts streak days", () => {
    const summary = summarizeDoseLogs([
      {
        id: "a",
        user_id: "user-1",
        medication_id: "med-1",
        scheduled_at: "2026-04-28T08:00:00.000Z",
        taken_at: null,
        status: "scheduled",
        notes: null,
      },
      {
        id: "b",
        user_id: "user-1",
        medication_id: "med-1",
        scheduled_at: "2026-04-28T20:00:00.000Z",
        taken_at: "2026-04-28T20:01:00.000Z",
        status: "taken",
        notes: null,
      },
      {
        id: "c",
        user_id: "user-1",
        medication_id: "med-1",
        scheduled_at: "2026-04-27T08:00:00.000Z",
        taken_at: null,
        status: "missed",
        notes: null,
      },
      {
        id: "d",
        user_id: "user-1",
        medication_id: "med-1",
        scheduled_at: "2026-04-26T08:00:00.000Z",
        taken_at: "2026-04-26T08:02:00.000Z",
        status: "taken",
        notes: null,
      },
    ]);

    expect(summary.upcoming).toHaveLength(1);
    expect(summary.completed).toHaveLength(2);
    expect(summary.missed).toHaveLength(1);
    expect(summary.streak).toBe(2);
  });
});

describe("countTakenDays", () => {
  it("dedupes multiple taken doses on the same calendar day", () => {
    // Two different times that are guaranteed to fall on the same local
    // calendar day across all common timezones (mid-day spread).
    const taken = countTakenDays([
      { scheduled_at: "2026-04-28T12:00:00.000Z", status: "taken" },
      { scheduled_at: "2026-04-28T15:00:00.000Z", status: "taken" },
    ]);
    expect(taken).toBe(1);
  });

  it("ignores rows that are not taken", () => {
    expect(
      countTakenDays([
        { scheduled_at: "2026-04-28T12:00:00.000Z", status: "scheduled" },
        { scheduled_at: "2026-04-27T12:00:00.000Z", status: "missed" },
      ]),
    ).toBe(0);
  });
});

describe("computeAdherenceByPatient", () => {
  it("returns 0 for accepted patients with no rows in window", () => {
    const result = computeAdherenceByPatient([], ["patient-a", "patient-b"]);
    expect(result.get("patient-a")).toBe(0);
    expect(result.get("patient-b")).toBe(0);
  });

  it("computes percentage per patient and rounds to nearest int", () => {
    const result = computeAdherenceByPatient(
      [
        { user_id: "patient-a", status: "taken" },
        { user_id: "patient-a", status: "missed" },
        { user_id: "patient-a", status: "taken" },
        { user_id: "patient-b", status: "scheduled" },
        { user_id: "patient-b", status: "scheduled" },
      ],
      ["patient-a", "patient-b", "patient-c"],
    );

    // 2 of 3 taken => 67%
    expect(result.get("patient-a")).toBe(67);
    expect(result.get("patient-b")).toBe(0);
    // patient-c has no rows but is still in the result map.
    expect(result.get("patient-c")).toBe(0);
  });
});
