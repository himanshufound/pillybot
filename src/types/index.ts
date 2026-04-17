export type DoseStatus = "pending" | "scheduled" | "taken" | "missed" | "skipped";

export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  timezone: string;
};

export type Medication = {
  id: string;
  user_id: string;
  name: string;
  dosage: string;
  color?: string | null;
  shape?: string | null;
  schedule_times?: string[] | null;
  schedule?: string | null;
  instructions: string | null;
  active: boolean;
};

export type DoseLog = {
  id: string;
  user_id: string;
  medication_id: string;
  scheduled_at: string;
  taken_at: string | null;
  status: DoseStatus;
  notes: string | null;
  verification_result?: VerificationResult | null;
  medications?: Pick<Medication, "name" | "dosage" | "color" | "shape"> | null;
};

export type Alert = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
};

export type CaregiverLink = {
  id: string;
  caregiver_id: string;
  patient_id: string;
  relationship: string | null;
  status?: "pending" | "accepted" | "declined";
  created_at: string;
  patient?: Profile | null;
  caregiver?: Profile | null;
};

export type VerificationResult = {
  verified: boolean;
  confidence: number;
  description: string;
  concerns: string[];
  safe_to_take: boolean;
  message: string;
};
