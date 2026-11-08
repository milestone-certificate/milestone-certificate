import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { homeForRoles } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";
import { Eye, EyeOff, KeyRound, Lock, LogIn, Mail, ShieldCheck, Smartphone } from "lucide-react";
import { checkDeviceSession, claimDeviceSession } from "@/lib/device-session";
import space1 from "@/assets/space-1.webp";
import space2 from "@/assets/space-2.webp";
import space3 from "@/assets/space-3.webp";

const slides = [space1, space2, space3];
const mobileSchema = z.string().regex(/^01[3-9]\d{8}$/);

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "লগইন — পরীক্ষা ব্যবস্থাপনা" },
      {
        name: "description",
        content: "মোবাইল নম্বর ও পাসওয়ার্ড দিয়ে পরীক্ষা ব্যবস্থাপনা পোর্টালে প্রবেশ করুন।",
      },
      {
        property: "og:title",
        content: "লগইন — পরীক্ষা ব্যবস্থাপনা",
      },
      {
        property: "og:description",
        content: "মোবাইল নম্বর ও পাসওয়ার্ড দিয়ে নিরাপদে প্রবেশ করুন।",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

const fieldCls =
  "peer h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-12 pr-12 text-center text-lg text-white placeholder:text-white/25 outline-none backdrop-blur-sm transition-all duration-300 focus:border-cyan-300/60 focus:bg-white/[0.08] focus:shadow-[0_0_40px_-10px_rgba(34,211,238,0.55)]";

function GlowField({
  icon,
  right,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  icon: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="group relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40 transition-colors duration-300 group-focus-within:text-cyan-300">
        {icon}
      </span>
      <input {...props} className={fieldCls} />
      {right && <span className="absolute right-3 top-1/2 -translate-y-1/2">{right}</span>}
      <span className="pointer-events-none absolute inset-x-8 -bottom-px h-px bg-gradient-to-r from-transparent via-cyan-300/0 to-transparent transition-all duration-500 group-focus-within:via-cyan-300/80" />
    </div>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "change">("login");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slide, setSlide] = useState(0);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("remember_login");
    if (saved) setMobile(saved);
    const timer = window.setInterval(() => setSlide((c) => (c + 1) % slides.length), 7000);
    return () => window.clearInterval(timer);
  }, []);

  // Show why this device was signed out; auto-enter if still within the 12h device session.
  useEffect(() => {
    const reason = sessionStorage.getItem("logout_reason");
    if (reason) {
      sessionStorage.removeItem("logout_reason");
      toast.error(reason);
    }
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      if (await checkDeviceSession()) return;
      const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id);
      if (roleError) return;
      navigate({ to: homeForRoles((roles ?? []).map((r) => r.role as string)), replace: true });
    })().catch(() => {
      /* Keep the login form available while verification is unavailable. */
    });
  }, [navigate]);

  const eye = (
    <button
      type="button"
      onClick={() => setShow((v) => !v)}
      aria-label={show ? "পাসওয়ার্ড লুকান" : "পাসওয়ার্ড দেখুন"}
      className="text-white/50 transition-colors hover:text-white"
    >
      {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
    </button>
  );

  const isEmail = mobile.includes("@");
  const loginEmail = isEmail ? mobile.trim().toLowerCase() : `88${mobile}@phone.login.local`;

  const signIn = async () => {
    try {
      let { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      // Retry once with trimmed password (mobile keyboards often add a trailing space).
      if ((error || !data.user) && password.trim() !== password) {
        ({ data, error } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password: password.trim(),
        }));
      }
      if (error || !data.user) return null;
      return data.user;
    } catch {
      return null;
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isEmail) {
      if (!z.string().email().safeParse(mobile.trim()).success)
        return toast.error("সঠিক ইমেইল দিন");
    } else if (!mobileSchema.safeParse(mobile).success)
      return toast.error("সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন");
    if (!password) return;
    setBusy(true);
    const user = await signIn();
    if (!user) {
      setBusy(false);
      return toast.error(
        mode === "login"
          ? "লগইন তথ্য বা পাসওয়ার্ড সঠিক নয়"
          : "লগইন তথ্য বা বর্তমান পাসওয়ার্ড সঠিক নয়",
      );
    }
    if (remember) localStorage.setItem("remember_login", mobile.trim());
    else localStorage.removeItem("remember_login");
    if (mode === "change") {
      if (newPass.length < 6) {
        setBusy(false);
        return toast.error("নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে");
      }
      if (newPass !== confirmPass) {
        setBusy(false);
        return toast.error("নতুন পাসওয়ার্ড দুটি মিলছে না");
      }
      const { error } = await supabase.auth.updateUser({
        password: newPass,
        current_password: password,
      } as { password: string; current_password?: string });
      if (error) {
        setBusy(false);
        return toast.error("পাসওয়ার্ড পরিবর্তন করা যায়নি");
      }
      toast.success("পাসওয়ার্ড পরিবর্তন হয়েছে — নতুন পাসওয়ার্ড দিয়ে লগইন হয়েছে");
    } else {
      toast.success("সফলভাবে লগইন হয়েছে");
    }
    try {
      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (roleError) throw new Error("Role verification unavailable");
      const roles = (roleRows ?? []).map((r) => r.role as string);
      await claimDeviceSession(roles.includes("admin"));
      navigate({ to: homeForRoles(roles), replace: true });
    } catch {
      toast.error("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন");
    } finally {
      setBusy(false);
    }
  };

  const idOk = isEmail ? mobile.trim().length > 5 : mobile.length === 11;
  const canSubmit =
    idOk && !!password && (mode === "login" || (newPass.length >= 6 && newPass === confirmPass));

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-black px-4 py-8 sm:px-6">
      <div className="absolute inset-0 -z-20" aria-hidden="true">
        {slides.map((image, index) => (
          <img
            key={image}
            src={image}
            alt=""
            width={1920}
            height={1088}
            loading={index === 0 ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full scale-105 object-cover transition-all duration-[2500ms] ease-in-out motion-reduce:transition-none ${index === slide ? "scale-100 opacity-100" : "opacity-0"}`}
          />
        ))}
      </div>
      <div
        className="absolute inset-0 -z-10 bg-gradient-to-b from-black/70 via-black/45 to-black/80"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -left-32 top-1/4 -z-10 h-96 w-96 rounded-full bg-cyan-500/15 blur-[120px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-32 bottom-1/4 -z-10 h-96 w-96 rounded-full bg-indigo-500/20 blur-[120px]"
        aria-hidden="true"
      />

      <section className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="relative">
            <span
              className="absolute inset-0 -z-10 rounded-full bg-cyan-400/30 blur-2xl"
              aria-hidden="true"
            />
            <img
              src="/portal-icon.svg"
              alt="অ্যাকাউন্ট পোর্টাল"
              className="h-20 w-20 rounded-full border border-white/20 object-cover shadow-[0_0_50px_-10px_rgba(34,211,238,0.7)]"
            />
          </div>
          <div className="text-center">
            <p className="font-display text-lg font-bold tracking-wide text-white">
              পরীক্ষার্থী পোর্টাল
            </p>
            <p className="text-xs tracking-[0.3em] text-cyan-200/70">স্কিল ভেরিফিকেশন পোর্টাল</p>
          </div>
        </div>

        <div className="rounded-[2rem] bg-gradient-to-br from-cyan-400/50 via-white/10 to-indigo-500/50 p-px shadow-[0_0_90px_-25px_rgba(34,211,238,0.6)]">
          <form
            onSubmit={submit}
            className="rounded-[calc(2rem-1px)] bg-black/70 p-7 backdrop-blur-2xl sm:p-9"
          >
            <div className="animate-in fade-in slide-in-from-bottom-2 space-y-5 duration-500">
              <div className="grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/5 p-1 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className={`flex items-center justify-center gap-1.5 rounded-full py-2 transition-all duration-300 ${mode === "login" ? "bg-cyan-400 text-black shadow-[0_0_25px_-6px_rgba(34,211,238,0.9)]" : "text-white/60 hover:text-white"}`}
                >
                  <LogIn className="h-4 w-4" /> লগইন
                </button>
                <button
                  type="button"
                  onClick={() => setMode("change")}
                  className={`flex items-center justify-center gap-1.5 rounded-full py-2 transition-all duration-300 ${mode === "change" ? "bg-cyan-400 text-black shadow-[0_0_25px_-6px_rgba(34,211,238,0.9)]" : "text-white/60 hover:text-white"}`}
                >
                  <KeyRound className="h-4 w-4" /> পাসওয়ার্ড বদলান
                </button>
              </div>

              <GlowField
                icon={isEmail ? <Mail className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
                id="mobile"
                type="text"
                autoComplete="username"
                placeholder="মোবাইল নম্বর বা ইমেইল"
                value={mobile}
                onChange={(e) => {
                  // Bengali digits → English; strip +88/88 country code.
                  const v = e.target.value.replace(/[০-৯]/g, (d) =>
                    String("০১২৩৪৫৬৭৮৯".indexOf(d)),
                  );
                  if (/[a-zA-Z@]/.test(v)) return setMobile(v.replace(/\s/g, ""));
                  let digits = v.replace(/\D/g, "");
                  if (digits.startsWith("880")) digits = digits.slice(2);
                  setMobile(digits.slice(0, 11));
                }}
                required
                style={{ letterSpacing: isEmail ? "0.02em" : "0.2em" }}
              />
              <GlowField
                icon={<Lock className="h-5 w-5" />}
                id="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                placeholder={mode === "login" ? "পাসওয়ার্ড" : "বর্তমান পাসওয়ার্ড"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                right={eye}
              />
              {mode === "change" && (
                <div className="animate-in fade-in slide-in-from-top-2 space-y-4 duration-300">
                  <GlowField
                    icon={<KeyRound className="h-5 w-5" />}
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="নতুন পাসওয়ার্ড (৬+ অক্ষর)"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    required
                  />
                  <GlowField
                    icon={<KeyRound className="h-5 w-5" />}
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="নতুন পাসওয়ার্ড আবার দিন"
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    required
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !canSubmit}
                className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-cyan-400 to-indigo-500 py-3.5 text-base font-bold text-black transition-all duration-300 hover:shadow-[0_0_45px_-8px_rgba(34,211,238,0.9)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  aria-hidden="true"
                />
                <span className="relative">
                  {busy
                    ? "অপেক্ষা করুন..."
                    : mode === "login"
                      ? "লগইন করুন"
                      : "পাসওয়ার্ড পরিবর্তন করুন"}
                </span>
              </button>

              <label className="flex cursor-pointer items-center justify-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 accent-cyan-400"
                />
                মোবাইল নম্বর / ইমেইল মনে রাখুন
              </label>
              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => setMode("change")}
                  className="block w-full text-center text-sm text-cyan-300/80 transition-colors hover:text-cyan-200"
                >
                  পাসওয়ার্ড ভুলে গেছেন? এখান থেকেই বদলে নিন
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="mt-6 flex justify-center gap-2" aria-hidden="true">
          {slides.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-500 ${i === slide ? "w-6 bg-cyan-300" : "w-1.5 bg-white/30"}`}
            />
          ))}
        </div>

        <div className="mt-5 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-4 py-1.5 text-[11px] font-semibold text-emerald-200 shadow-[0_0_25px_-8px_rgba(52,211,153,0.8)] backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5" /> 256-Bit SSL Encrypted &amp; Official Skill
            Verification Portal
          </span>
        </div>
        <p className="mt-3 text-center text-[11px] text-white/45">নিরাপদ অ্যাকাউন্ট প্রবেশ</p>
      </section>
    </main>
  );
}
