import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Loader } from "../components/Loader";
import { Notice } from "../components/Notice";
import { useAuth } from "../lib/auth";
import { getFunctionErrorMessage, isLowConfidenceVerificationResult } from "../lib/edgeFunctionClient";
import { supabase } from "../lib/supabase";
import type { DoseLog, Medication, VerificationResult } from "../types";

const MAX_IMAGE_EDGE = 1200;

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not capture image."));
        return;
      }
      resolve(blob);
    }, "image/jpeg", 0.86);
  });
}

export default function VerifyPage() {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [doseLogs, setDoseLogs] = useState<DoseLog[]>([]);
  const [medicationId, setMedicationId] = useState("");
  const [doseLogId, setDoseLogId] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    const userId = user.id;

    async function loadOptions() {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const [medicationResult, doseResult] = await Promise.all([
          supabase
            .from("medications")
            .select("id, user_id, name, dosage, color, shape, schedule_times, schedule, instructions, active")
            .eq("user_id", userId)
            .eq("active", true)
            .order("created_at", { ascending: false }),
          supabase
            .from("dose_logs")
            .select("id, user_id, medication_id, scheduled_at, taken_at, status, notes")
            .eq("user_id", userId)
            .gte("scheduled_at", today.toISOString())
            .lt("scheduled_at", tomorrow.toISOString())
            .order("scheduled_at", { ascending: true }),
        ]);

        if (medicationResult.error) throw medicationResult.error;
        if (doseResult.error) throw doseResult.error;

        const meds = (medicationResult.data ?? []) as Medication[];
        setMedications(meds);
        setDoseLogs((doseResult.data ?? []) as DoseLog[]);
        setMedicationId((current) => current || meds[0]?.id || "");
      } catch {
        setError("We could not load medications for verification.");
      }
    }

    loadOptions();
  }, [user]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      setError("Camera access was blocked or unavailable.");
    }
  }

  async function captureAndVerify() {
    if (!user || !videoRef.current || !medicationId) {
      setError("Choose a medication and start the camera first.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const video = videoRef.current;
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;

      if (!sourceWidth || !sourceHeight) {
        throw new Error("Camera is not ready.");
      }

      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sourceWidth * scale);
      canvas.height = Math.round(sourceHeight * scale);

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Could not prepare image.");
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas);
      if (blob.size > 5 * 1024 * 1024) {
        throw new Error("Captured image exceeds the 5MB upload limit. Move closer and try again.");
      }
      const imagePath = `users/${user.id}/pills/${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("pill-images")
        .upload(imagePath, blob, {
          cacheControl: "3600",
          contentType: "image/jpeg",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data, error: functionError } = await supabase.functions.invoke("verify-pill", {
        body: {
          imagePath,
          medicationId,
          doseLogId: doseLogId || undefined,
        },
      });

      if (functionError) throw functionError;
      const verificationResult = (data && typeof data === "object" && "verificationResult" in data)
        ? (data as { verificationResult: VerificationResult }).verificationResult
        : null;
      if (!verificationResult) {
        throw new Error("Verification failed. Please retake the image and try again.");
      }
      setResult(verificationResult);
    } catch (verifyError) {
      const responseData = verifyError && typeof verifyError === "object" && "context" in verifyError
        ? (verifyError as { context?: { json?: unknown } }).context?.json
        : null;
      setError(
        verifyError instanceof Error && verifyError.message.includes("5MB")
          ? verifyError.message
          : getFunctionErrorMessage(responseData, "Verification failed. Please retake the image and try again."),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-motion grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
      <section className="grid gap-5">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.22em] text-teal-700">AI verification</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">Verify before marking taken.</h1>
          <p className="mt-4 text-slate-600">Images go to private storage first. The browser never talks to Anthropic directly.</p>
        </div>

        <Card className="grid gap-4">
          {error ? <Notice type="error">{error}</Notice> : null}
          <label className="grid gap-2 text-sm font-bold text-slate-700">
            Medication
            <select className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4" onChange={(event) => setMedicationId(event.target.value)} value={medicationId}>
              {medications.map((medication) => (
                <option key={medication.id} value={medication.id}>
                  {medication.name} · {medication.dosage}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-bold text-slate-700">
            Dose log
            <select className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4" onChange={(event) => setDoseLogId(event.target.value)} value={doseLogId}>
              <option value="">No dose log selected</option>
              {doseLogs.map((dose) => (
                <option key={dose.id} value={dose.id}>
                  {new Date(dose.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {dose.status}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={startCamera} type="button" variant="secondary">Start camera</Button>
          <Button disabled={!cameraReady || loading || !medicationId} onClick={captureAndVerify} type="button">
            {loading ? "Verifying..." : "Capture and verify"}
          </Button>
        </Card>
      </section>

      <section className="grid gap-4">
        <div className="overflow-hidden rounded-[2rem] bg-slate-950 shadow-2xl">
          <video className="aspect-[4/3] w-full object-cover" muted playsInline ref={videoRef} />
        </div>
        {loading ? <Loader label="Checking pill image securely" /> : null}
        {result && isLowConfidenceVerificationResult(result) ? (
          <Notice type="info">Confidence is low. Review the pill manually before marking it as taken.</Notice>
        ) : null}
        {result ? (
          <Card>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Result</p>
            <h2 className="mt-2 text-3xl font-black text-slate-950">
              {result.verified ? "Verified" : "Needs review"}
            </h2>
            <p className="mt-2 text-slate-600">{result.message}</p>
            {!result.verified ? <p className="mt-2 text-sm font-semibold text-amber-700">Use this as guidance only and confirm the pill visually.</p> : null}
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.round(result.confidence * 100)}%` }} />
            </div>
            <p className="mt-2 text-sm font-bold text-slate-500">Confidence {Math.round(result.confidence * 100)}%</p>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
