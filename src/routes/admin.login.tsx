import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { claimDeviceSession } from "@/lib/device-session";
import { isManager } from "@/lib/roles";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import brandLogo from "@/assets/brand-logo.jpg";
import space1 from "@/assets/space-1.webp";
import space2 from "@/assets/space-2.webp";
import space3 from "@/assets/space-3.webp";

const slides = [space1, space2, space3];

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [
      { title: "অ্যাডমিন লগইন — পরীক্ষা ব্যবস্থাপনা | Milestone Certificate Institute" },
      {
        name: "description",
        content: "অ্যাডমিন ও স্টাফদের জন্য ইমেইল ও পাসওয়ার্ড দিয়ে নিরাপদ লগইন।",
      },
      {
        property: "og:title",
        content: "অ্যাডমিন লগইন — পরীক্ষা ব্যবস্থাপনা | Milestone Certificate Institute",
      },
      { property: "og:description", content: "অ্যাডমিন ও স্টাফদের জন্য নিরাপদ লগইন।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLogin,
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

function AdminLogin() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setSlide((s) => (s + 1) % slides.length), 7000);
    return () => window.clearInterval(t);
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !data.user) {
      setBusy(false);
      toast.error("ইমেইল বা পাসওয়ার্ড সঠিক নয়");
      return;
    }
    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    const roleNames = (roles ?? []).map((row) => row.role as string);
    if (rolesError || !isManager(roleNames)) {
      await supabase.auth.signOut({ scope: "local" });
      setBusy(false);
      toast.error(
        rolesError
          ? "অ্যাক্সেস যাচাই করা যায়নি — আবার চেষ্টা করুন"
          : "এই অ্যাকাউন্টের অ্যাডমিন অ্যাক্সেস নেই",
      );
      return;
    }
    queryClient.clear();
    try {
      await claimDeviceSession(roleNames.includes("admin"));
      await router.invalidate();
      navigate({ to: "/dashboard", replace: true });
    } catch {
      toast.error("সেশন তৈরি করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!email.trim()) return toast.error("প্রথমে ইমেইল লিখুন");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error("লিংক পাঠানো যায়নি");
    else toast.success("পাসওয়ার্ড রিসেট লিংক ইমেইলে পাঠানো হয়েছে");
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
              src={brandLogo}
              alt="Milestone Certificate Institute"
              className="h-20 w-20 rounded-full border border-white/20 object-cover shadow-[0_0_50px_-10px_rgba(34,211,238,0.7)]"
            />
          </div>
          <div className="text-center">
            <p className="font-display text-lg font-bold tracking-wide text-white">
              Milestone Certificate Institute
            </p>
            <p className="text-xs tracking-[0.3em] text-cyan-200/70">
              Explore Global Opportunities
            </p>
          </div>
        </div>

        <div className="rounded-[2rem] bg-gradient-to-br from-cyan-400/50 via-white/10 to-indigo-500/50 p-px shadow-[0_0_90px_-25px_rgba(34,211,238,0.6)]">
          <form
            onSubmit={login}
            className="rounded-[calc(2rem-1px)] bg-black/70 p-7 backdrop-blur-2xl sm:p-9"
          >
            <div className="animate-in fade-in slide-in-from-bottom-2 space-y-5 duration-500">
              <h1 className="sr-only">Admin Login</h1>

              <GlowField
                icon={<Mail className="h-5 w-5" />}
                id="email"
                type="email"
                autoComplete="email"
                placeholder="ইমেইল"
                value={email}
                onChange={(e) => setEmail(e.target.value.replace(/\s/g, ""))}
                required
                style={{ letterSpacing: "0.02em" }}
              />
              <GlowField
                icon={<Lock className="h-5 w-5" />}
                id="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                placeholder="পাসওয়ার্ড"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                right={eye}
              />

              <button
                type="submit"
                disabled={busy || !email.trim() || !password}
                className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-cyan-400 to-indigo-500 py-3.5 text-base font-bold text-black transition-all duration-300 hover:shadow-[0_0_45px_-8px_rgba(34,211,238,0.9)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  aria-hidden="true"
                />
                <span className="relative">{busy ? "অপেক্ষা করুন..." : "লগইন করুন"}</span>
              </button>

              <button
                type="button"
                onClick={forgot}
                className="block w-full text-center text-sm text-cyan-300/80 transition-colors hover:text-cyan-200"
              >
                পাসওয়ার্ড ভুলে গেছেন?
              </button>
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
        <p className="mt-3 text-center text-[11px] text-white/45">
          © {new Date().getFullYear()} Milestone Certificate Institute · সর্বস্বত্ব সংরক্ষিত
        </p>
      </section>
    </main>
  );
}
