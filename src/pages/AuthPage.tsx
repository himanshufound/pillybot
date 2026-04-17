import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { Loader } from "../components/Loader";
import { Notice } from "../components/Notice";
import { useAuth } from "../lib/auth";
import { signInWithMagicLink, signInWithPassword, supabase } from "../lib/supabase";

type AuthMode = "login" | "signup";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthPage() {
  const { loading: authLoading, user } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState<"password" | "magic" | "signup" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  if (authLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50">
        <Loader label="Checking your session" />
      </div>
    );
  }

  if (user) {
    return <Navigate replace to="/" />;
  }

  async function handlePasswordLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }

    if (!password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading("password");
    try {
      const { error: signInError } = await signInWithPassword(email.trim(), password);
      if (signInError) {
        setError(signInError.message);
      }
    } catch {
      setError("We could not sign you in. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  async function handleSignUp(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading("signup");
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      setMessage("Check your email to confirm your account");
      setPassword("");
    } catch {
      setError("We could not create your account. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  async function handleMagicLink() {
    setError("");
    setMessage("");

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Enter a valid email before requesting a magic link.");
      return;
    }

    setLoading("magic");
    try {
      const { error: magicError } = await signInWithMagicLink(email.trim());
      if (magicError) {
        setError(magicError.message);
        return;
      }
      setMessage("Check your inbox for a secure sign-in link.");
    } catch {
      setError("We could not send the magic link. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_16%_10%,rgba(20,184,166,0.2),transparent_26%),linear-gradient(135deg,#f8fafc,#fff7ed)] px-4 py-10">
      <section className="grid w-full max-w-5xl gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="page-motion">
          <p className="text-sm font-black uppercase tracking-[0.24em] text-teal-700">Pillybot</p>
          <h1 className="mt-4 max-w-xl text-5xl font-black tracking-tight text-slate-950 sm:text-7xl">
            Medication care, quietly coordinated.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-slate-600">
            Sign in to verify doses, review reminders, and keep caregivers in the loop without exposing private keys or backend credentials.
          </p>
        </div>

        <Card className="page-motion">
          <div className="mb-5 grid grid-cols-2 rounded-full bg-slate-100 p-1">
            <button
              className={`rounded-full px-4 py-2 text-sm font-black transition ${
                mode === "login" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
              }`}
              onClick={() => {
                setMode("login");
                setError("");
                setMessage("");
              }}
              type="button"
            >
              Login
            </button>
            <button
              className={`rounded-full px-4 py-2 text-sm font-black transition ${
                mode === "signup" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
              }`}
              onClick={() => {
                setMode("signup");
                setError("");
                setMessage("");
              }}
              type="button"
            >
              Sign Up
            </button>
          </div>

          <form className="grid gap-4" onSubmit={mode === "login" ? handlePasswordLogin : handleSignUp}>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-950">
                {mode === "login" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="mt-2 text-sm font-medium text-slate-500">
                {mode === "login"
                  ? "Use your Supabase-authenticated account."
                  : "Start with a secure email and password sign up."}
              </p>
            </div>

            {error ? <Notice type="error">{error}</Notice> : null}
            {message ? <Notice type="success">{message}</Notice> : null}

            <Input
              autoComplete="email"
              label="Email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
            <Input
              autoComplete="current-password"
              label="Password"
              minLength={mode === "signup" ? 6 : undefined}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              type="password"
              value={password}
            />

            <Button disabled={loading !== null} type="submit">
              {mode === "login"
                ? loading === "password" ? "Signing in..." : "Sign in"
                : loading === "signup" ? "Creating account..." : "Create account"}
            </Button>
            {mode === "login" ? (
              <Button disabled={loading !== null} onClick={handleMagicLink} type="button" variant="secondary">
                {loading === "magic" ? "Sending..." : "Send magic link"}
              </Button>
            ) : null}
          </form>
        </Card>
      </section>
    </main>
  );
}
