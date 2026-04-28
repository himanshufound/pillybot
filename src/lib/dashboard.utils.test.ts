import { describe, expect, it } from "vitest";
import { mapDoseLogRow, summarizeDoseLogs } from "./dashboard.utils";

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
