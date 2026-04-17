import { FormEvent, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input, Textarea } from "../components/Input";
import { Notice } from "../components/Notice";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function AddMedicationPage() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [color, setColor] = useState("");
  const [shape, setShape] = useState("");
  const [scheduleTimes, setScheduleTimes] = useState("08:00");
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!user) {
      setError("You need to be signed in to add medication.");
      return;
    }

    const times = scheduleTimes.split(",").map((time) => time.trim()).filter(Boolean);

    if (!name.trim() || name.trim().length > 100) {
      setError("Medication name is required and must be 100 characters or fewer.");
      return;
    }

    if (!dosage.trim() || dosage.trim().length > 50) {
      setError("Dosage is required and must be 50 characters or fewer.");
      return;
    }

    if (times.length === 0 || times.some((time) => !TIME_PATTERN.test(time))) {
      setError("Schedule times must use HH:MM format, separated by commas.");
      return;
    }

    setLoading(true);
    try {
      const { error: insertError } = await supabase.from("medications").insert({
        user_id: user.id,
        name: name.trim(),
        dosage: dosage.trim(),
        color: color.trim() || null,
        shape: shape.trim() || null,
        schedule_times: times,
        schedule: times.join(","),
        instructions: instructions.trim() || null,
        active: true,
      });

      if (insertError) throw insertError;

      setName("");
      setDosage("");
      setColor("");
      setShape("");
      setScheduleTimes("08:00");
      setInstructions("");
      setMessage("Medication saved securely.");
    } catch {
      setError("We could not save this medication. Check the fields and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-motion grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
      <section>
        <p className="text-sm font-black uppercase tracking-[0.22em] text-teal-700">Medication</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">Add a routine.</h1>
        <p className="mt-4 max-w-md text-slate-600">
          Keep details concise so reminders are clear for patients and caregivers.
        </p>
      </section>

      <Card>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          {error ? <Notice type="error">{error}</Notice> : null}
          {message ? <Notice type="success">{message}</Notice> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Name" maxLength={100} onChange={(event) => setName(event.target.value)} value={name} />
            <Input label="Dosage" maxLength={50} onChange={(event) => setDosage(event.target.value)} value={dosage} />
            <Input label="Color" onChange={(event) => setColor(event.target.value)} placeholder="White" value={color} />
            <Input label="Shape" onChange={(event) => setShape(event.target.value)} placeholder="Round" value={shape} />
          </div>

          <Input
            label="Schedule times"
            onChange={(event) => setScheduleTimes(event.target.value)}
            placeholder="08:00, 20:00"
            value={scheduleTimes}
          />
          <Textarea
            label="Instructions"
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Take with food."
            value={instructions}
          />

          <Button disabled={loading} type="submit">
            {loading ? "Saving..." : "Save medication"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
