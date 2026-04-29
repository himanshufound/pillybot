import type { DoseLog } from "../types";

type MedicationRow = {
  name?: string | null;
  dosage?: string | null;
  color?: string | null;
  shape?: string | null;
};

type DoseLogRow = Omit<DoseLog, "status" | "medications"> & {
  status: string;
  medications?: MedicationRow | MedicationRow[] | null;
};

export function mapDoseLogRow(row: DoseLogRow): DoseLog {
  const medication = Array.isArray(row.medications) ? row.medications[0] : row.medications;

  return {
    id: row.id,
    user_id: row.user_id,
    medication_id: row.medication_id,
    scheduled_at: row.scheduled_at,
    taken_at: row.taken_at,
    status: row.status as DoseLog["status"],
    notes: row.notes,
    verification_result: row.verification_result,
    medications: medication
      ? {
          name: medication.name ?? "Medication",
          dosage: medication.dosage ?? "Dose scheduled",
          color: medication.color ?? null,
          shape: medication.shape ?? null,
        }
      : null,
  };
}

export function summarizeDoseLogs(doseLogs: DoseLog[]) {
  const upcoming = doseLogs.filter((dose) => dose.status === "scheduled");
  const completed = doseLogs.filter((dose) => dose.status === "taken");
  const missed = doseLogs.filter((dose) => dose.status === "missed");
  const cleanDays = new Set<string>();

  for (const row of completed) {
    cleanDays.add(new Date(row.scheduled_at).toDateString());
  }

  return {
    upcoming,
    completed,
    missed,
    streak: cleanDays.size,
  };
}

type StreakRow = { scheduled_at: string; status: string };

export function countTakenDays(rows: StreakRow[]) {
  const cleanDays = new Set<string>();
  for (const row of rows) {
    if (row.status === "taken") {
      cleanDays.add(new Date(row.scheduled_at).toDateString());
    }
  }
  return cleanDays.size;
}

type AdherenceRow = { user_id: string; status: string };

export function computeAdherenceByPatient(
  rows: AdherenceRow[],
  patientIds: string[],
) {
  const totals = new Map<string, { taken: number; total: number }>();
  for (const row of rows) {
    const acc = totals.get(row.user_id) ?? { taken: 0, total: 0 };
    acc.total += 1;
    if (row.status === "taken") acc.taken += 1;
    totals.set(row.user_id, acc);
  }

  const adherence = new Map<string, number>();
  for (const patientId of patientIds) {
    const acc = totals.get(patientId);
    adherence.set(
      patientId,
      acc && acc.total > 0 ? Math.round((acc.taken / acc.total) * 100) : 0,
    );
  }
  return adherence;
}
