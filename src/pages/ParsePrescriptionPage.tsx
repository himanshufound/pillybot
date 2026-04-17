import { ChangeEvent, useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Loader } from "../components/Loader";
import { Notice } from "../components/Notice";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

type ParsedPrescriptionResult = {
  medication_name?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  times?: string[] | null;
  instructions?: string | null;
  confidence?: number | null;
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);

export default function ParsePrescriptionPage() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ParsedPrescriptionResult | null>(null);

  const previewUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setError("");
    setMessage("");
    setResult(null);

    if (!nextFile) {
      setFile(null);
      return;
    }

    if (!ALLOWED_TYPES.has(nextFile.type)) {
      setError("Only JPEG and PNG images are allowed.");
      setFile(null);
      return;
    }

    if (nextFile.size > MAX_FILE_BYTES) {
      setError("Image must be 5MB or smaller.");
      setFile(null);
      return;
    }

    setFile(nextFile);
  }

  async function handleParse() {
    if (!user) {
      setError("You need to be signed in to parse a prescription.");
      return;
    }

    if (!file) {
      setError("Choose a prescription image first.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");
    setResult(null);

    try {
      const extension = file.type === "image/png" ? "png" : "jpg";
      const imagePath = `users/${user.id}/prescriptions/${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("prescription-temp")
        .upload(imagePath, file, {
          cacheControl: "300",
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data, error: functionError } = await supabase.functions.invoke("parse-prescription", {
        body: { imagePath },
      });

      if (functionError) {
        throw functionError;
      }

      setResult((data ?? null) as ParsedPrescriptionResult | null);
      setMessage("Prescription parsed successfully.");
    } catch {
      setError("We could not parse that prescription image. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-motion grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="grid gap-5">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.22em] text-teal-700">Prescription parser</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">
            Turn a prescription photo into structured medication details.
          </h1>
          <p className="mt-4 text-slate-600">
            Upload or capture a prescription image, store it in temporary private storage, and send it only to the secure `parse-prescription` Edge Function.
          </p>
        </div>

        <Card className="grid gap-4">
          {error ? <Notice type="error">{error}</Notice> : null}
          {message ? <Notice type="success">{message}</Notice> : null}

          <label className="grid gap-2 text-sm font-bold text-slate-700">
            Prescription image
            <input
              accept="image/jpeg,image/png"
              capture="environment"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
              onChange={handleFileChange}
              type="file"
            />
          </label>

          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            JPEG or PNG only, maximum 5MB
          </p>

          <Button disabled={!file || loading} onClick={handleParse} type="button">
            {loading ? "Parsing..." : "Parse prescription"}
          </Button>
        </Card>
      </section>

      <section className="grid gap-4">
        <Card className="grid gap-4">
          <h2 className="text-2xl font-black text-slate-950">Image preview</h2>
          {previewUrl ? (
            <img
              alt="Prescription preview"
              className="max-h-[28rem] w-full rounded-[1.5rem] object-contain bg-slate-100"
              src={previewUrl}
            />
          ) : (
            <div className="grid min-h-72 place-items-center rounded-[1.5rem] bg-slate-100 text-sm font-semibold text-slate-500">
              Select a prescription image to preview it here.
            </div>
          )}
        </Card>

        {loading ? <Loader label="Reading prescription securely" /> : null}

        {result ? (
          <Card className="grid gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Extracted data</p>
              <h2 className="mt-2 text-3xl font-black text-slate-950">
                {result.medication_name ?? "Medication detected"}
              </h2>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Dosage</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-700">{result.dosage ?? "Not available"}</dd>
              </div>
              <div>
                <dt className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Frequency</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-700">{result.frequency ?? "Not available"}</dd>
              </div>
              <div>
                <dt className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Times</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-700">
                  {result.times?.length ? result.times.join(", ") : "Not available"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Confidence</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-700">
                  {typeof result.confidence === "number"
                    ? `${Math.round(result.confidence * 100)}%`
                    : "Not available"}
                </dd>
              </div>
            </dl>

            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Instructions</p>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                {result.instructions ?? "No instructions were extracted."}
              </p>
            </div>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
