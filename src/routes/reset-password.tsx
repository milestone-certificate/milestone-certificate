import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import space1 from "@/assets/space-1.webp";
import space2 from "@/assets/space-2.webp";
import space3 from "@/assets/space-3.webp";

const slides = [space1, space2, space3];

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "নতুন পাসওয়ার্ড — পরীক্ষা ব্যবস্থাপনা" },
      { name: "description", content: "আপনার অ্যাকাউন্টের নতুন পাসওয়ার্ড সেট করুন।" },
      {
        property: "og:title",
        content: "নতুন পাসওয়ার্ড — পরীক্ষা ব্যবস্থাপনা",
      },
      { property: "og:description", content: "আপনার অ্যাকাউন্টের নতুন পাসওয়ার্ড সেট করুন।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPassword,
});

const fieldCls =
  "peer h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-12 pr-12 text-center text-lg text-white placeholder:text-white/25 outline-none backdrop-blur-sm transition-all duration-300 focus:border-cyan-300/60 focus:bg-white/[0.08] focus:shadow-[0_0_40px_-10px_rgba(34,211,238,0.55)]";

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setSlide((s) => (s + 1) % slides.length), 7000);
    return () => window.clearInterval(t);
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("কমপক্ষে ৮ অক্ষরের পাসওয়ার্ড দিন");
    if (password !== confirm) return toast.error("পাসওয়ার্ড দুটি মিলছে না");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error("পাসওয়ার্ড পরিবর্তন করা যায়নি");
    toast.success("পাসওয়ার্ড পরিবর্তন হয়েছে");
    navigate({ to: "/dashboard", replace: true });
  };

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

  const field = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="group relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40 transition-colors duration-300 group-focus-within:text-cyan-300">
        <KeyRound className="h-5 w-5" />
      </span>
      <input {...props} className={fieldCls} />
      <span className="absolute right-3 top-1/2 -translate-y-1/2">{eye}</span>
      <span className="pointer-events-none absolute inset-x-8 -bottom-px h-px bg-gradient-to-r from-transparent via-cyan-300/0 to-transparent transition-all duration-500 group-focus-within:via-cyan-300/80" />
    </div>
  );

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
            <p className="text-xs tracking-[0.3em] text-cyan-200/70">পাসওয়ার্ড রিসেট</p>
          </div>
        </div>

        <div className="rounded-[2rem] bg-gradient-to-br from-cyan-400/50 via-white/10 to-indigo-500/50 p-px shadow-[0_0_90px_-25px_rgba(34,211,238,0.6)]">
          <form
            onSubmit={save}
            className="rounded-[calc(2rem-1px)] bg-black/70 p-7 backdrop-blur-2xl sm:p-9"
          >
            <div className="animate-in fade-in slide-in-from-bottom-2 space-y-5 duration-500">
              <h1 className="text-center text-lg font-semibold text-white">
                নতুন পাসওয়ার্ড সেট করুন
              </h1>
              {field({
                type: show ? "text" : "password",
                autoComplete: "new-password",
                placeholder: "নতুন পাসওয়ার্ড (৮+ অক্ষর)",
                value: password,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value),
                required: true,
              })}
              {field({
                type: show ? "text" : "password",
                autoComplete: "new-password",
                placeholder: "নতুন পাসওয়ার্ড আবার দিন",
                value: confirm,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value),
                required: true,
              })}
              <button
                type="submit"
                disabled={busy || password.length < 8 || password !== confirm}
                className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-cyan-400 to-indigo-500 py-3.5 text-base font-bold text-black transition-all duration-300 hover:shadow-[0_0_45px_-8px_rgba(34,211,238,0.9)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  aria-hidden="true"
                />
                <span className="relative">{busy ? "অপেক্ষা করুন..." : "সংরক্ষণ করুন"}</span>
              </button>
            </div>
          </form>
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
