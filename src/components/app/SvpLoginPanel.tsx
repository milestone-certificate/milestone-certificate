import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import {
  resendSvpOtp,
  resendStoredSvpOtp,
  submitStoredSvpOtp,
  submitSvpLogin,
} from "@/lib/svp-session.functions";
import { svpLoginInputSchema, svpOtpInputSchema } from "@/lib/svp-session.shared";
import { svpMailboxUrl, reserveSvpMail } from "@/lib/svp-mail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/ui-bits";

type FormState = {
  login: string;
  password: string;
  otpAttempt: string;
};

type LoginStep = "login" | "otp";

type Status = { tone: "ok" | "error"; text: string };

const EMPTY_FORM: FormState = { login: "", password: "", otpAttempt: "" };

export function SvpLoginPanel({
  onSignedIn,
  otpOnly = false,
  login = "",
}: {
  onSignedIn?: () => void;
  /** Reconnect mode: the password is already stored server-side, only the OTP is needed. */
  otpOnly?: boolean;
  login?: string;
} = {}) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, login });
  const [step, setStep] = useState<LoginStep>(otpOnly ? "otp" : "login");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const busyRef = useRef(false);
  const mailbox = svpMailboxUrl(form.login);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const reset = () => {
    setForm({ ...EMPTY_FORM, login: otpOnly ? login : "" });
    setStep(otpOnly ? "otp" : "login");
    setStatus(null);
    setShowPassword(false);
    setResendIn(0);
  };

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const resend = async () => {
    if (resending || resendIn > 0) return;
    const parsed = svpLoginInputSchema.safeParse({ login: form.login, password: form.password });
    if (!otpOnly && !parsed.success) {
      setStatus({ tone: "error", text: "ইমেইল ও পাসওয়ার্ড আবার দিন।" });
      return;
    }
    const mail = reserveSvpMail(form.login);
    setResending(true);
    try {
      const result = otpOnly
        ? await resendStoredSvpOtp()
        : await resendSvpOtp({ data: parsed.success ? parsed.data : { login: "", password: "" } });
      mail?.finish(result.ok);
      setStatus({
        tone: result.ok ? "ok" : "error",
        text: result.ok
          ? step === "login"
            ? "ইমেইলে OTP পাঠানো হয়েছে"
            : "নতুন OTP পাঠানো হয়েছে"
          : "OTP পাঠানো যায়নি। আবার চেষ্টা করুন।",
      });
      if (result.ok) setResendIn(60);
    } catch {
      mail?.finish(false);
      setStatus({ tone: "error", text: "OTP পাঠানো যায়নি। আবার চেষ্টা করুন।" });
    } finally {
      setResending(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;

    const parsed = otpOnly
      ? null
      : step === "login"
        ? svpLoginInputSchema.safeParse({ login: form.login, password: form.password })
        : svpOtpInputSchema.safeParse({
            login: form.login,
            password: form.password,
            otpAttempt: form.otpAttempt,
          });

    if (!otpOnly && !parsed?.success) {
      setStatus({
        tone: "error",
        text: step === "login" ? "ইমেইল ও পাসওয়ার্ড দিন।" : "OTP দিন।",
      });
      return;
    }

    const mail = step === "login" ? reserveSvpMail(form.login) : null;
    busyRef.current = true;
    setBusy(true);
    setStatus(null);
    try {
      if (otpOnly) {
        if (!form.otpAttempt.trim()) {
          setStatus({ tone: "error", text: "OTP দিন।" });
          return;
        }
        const stored = await submitStoredSvpOtp({ data: { otpAttempt: form.otpAttempt } });
        setStatus({
          tone: stored.ok ? "ok" : "error",
          text: stored.ok ? "সংযোগ হয়েছে" : "OTP সঠিক নয় বা মেয়াদ শেষ। নতুন কোড নিন।",
        });
        if (stored.ok) onSignedIn?.();
        return;
      }
      const result =
        step === "login"
          ? await submitSvpLogin({ data: { ...parsed!.data, step: "login" } })
          : await submitSvpLogin({ data: { ...parsed!.data, step: "otp" } });

      mail?.finish(Boolean(result.otpRequired));
      setStatus({
        tone: result.ok ? "ok" : "error",
        text: result.ok
          ? result.otpRequired
            ? "ইমেইলে OTP পাঠানো হয়েছে"
            : "সংযোগ হয়েছে"
          : step === "otp"
            ? "OTP সঠিক নয় বা মেয়াদ শেষ। নতুন কোড নিন।"
            : "ইমেইল ও পাসওয়ার্ড মিলিয়ে নিন।",
      });
      if (step === "login" && result.otpRequired) {
        setStep("otp");
      }
      if (result.authenticated && result.session) {
        onSignedIn?.();
      }
    } catch {
      mail?.finish(false);
      setStatus({
        tone: "error",
        text: "সংযোগ হয়নি। আবার চেষ্টা করুন।",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section
      className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6"
      aria-labelledby="svp-login-title"
    >
      <div>
        <h2 id="svp-login-title" className="text-xl font-bold">
          {step === "login" ? "SVP লগইন" : "OTP যাচাই"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {step === "login" ? "SVP ইমেইল ও পাসওয়ার্ড দিন।" : `${form.login}–এ পাঠানো OTP দিন।`}
        </p>
      </div>

      {mailbox && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {step === "otp" && (
            <a
              href={mailbox}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline"
            >
              Yopmail খুলুন
            </a>
          )}
        </div>
      )}
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {step === "login" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SVP ইমেইল">
              <Input
                name="login"
                value={form.login}
                onChange={(event) => update("login", event.target.value)}
                autoComplete="username"
                disabled={busy}
                required
              />
            </Field>
            <Field label="পাসওয়ার্ড">
              <div className="relative">
                <Input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(event) => update("password", event.target.value)}
                  autoComplete="current-password"
                  className="pr-10"
                  disabled={busy}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "পাসওয়ার্ড লুকান" : "পাসওয়ার্ড দেখুন"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
          </div>
        ) : (
          <Field label="OTP কোড">
            <Input
              name="otp"
              value={form.otpAttempt}
              onChange={(event) => update("otpAttempt", event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={busy}
              required
            />
          </Field>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "অপেক্ষা করুন…" : step === "login" ? "পরের ধাপ" : "OTP যাচাই"}
          </Button>
          {step === "otp" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void resend()}
              disabled={busy || resending || resendIn > 0}
            >
              {resending ? "পাঠানো হচ্ছে…" : resendIn > 0 ? `${resendIn} সেকেন্ড পরে` : "নতুন OTP"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={reset} disabled={busy}>
            <RotateCcw className="mr-2 h-4 w-4" /> মুছুন
          </Button>
        </div>
      </form>

      {status && (
        <div
          role={status.tone === "error" ? "alert" : "status"}
          className={`space-y-1 rounded-lg border p-3 text-sm ${
            status.tone === "error"
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "bg-muted/40"
          }`}
        >
          <p>{status.text}</p>
        </div>
      )}
    </section>
  );
}
