import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { isPublicSurface } from "@/lib/public-surface";
import brandLogo from "@/assets/brand-logo.jpg";

type Size = "sm" | "md" | "lg";
const dims: Record<Size, string> = { sm: "h-8 w-8", md: "h-20 w-20", lg: "h-32 w-32" };

/** Black-hole / vortex loader: spinning accretion rings swirl around the waving brand logo. */
export function WorkerLoader({
  size = "md",
  label,
  branded = true,
}: {
  size?: Size;
  label?: string;
  branded?: boolean;
}) {
  return (
    <span className="inline-flex flex-col items-center gap-3">
      <span className={`relative inline-block ${dims[size]}`}>
        <span className="bh-disk absolute -inset-[45%] rounded-full" />
        <span className="bh-ring absolute -inset-[25%] rounded-full border-2 border-transparent border-t-primary border-l-primary/40" />
        <span className="bh-ring-rev absolute -inset-[12%] rounded-full border-2 border-transparent border-b-accent border-r-primary/60" />
        <span className="absolute -inset-1 rounded-full bg-background shadow-[0_0_30px_8px_color-mix(in_oklab,var(--primary)_55%,transparent)]" />
        <img
          src={branded ? brandLogo : "/portal-icon.svg"}
          alt=""
          className="logo-wave relative h-full w-full rounded-full object-cover"
        />
      </span>
      {label && <span className="text-sm font-medium text-primary animate-pulse">{label}</span>}
    </span>
  );
}

export function PageLoader() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <WorkerLoader size="lg" label="লোড হচ্ছে..." branded={!isPublicSurface(path)} />
    </div>
  );
}

/** Instant overlay loader: shows on any button/link click and during page navigation. */
export function NavLoader() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const loading = useRouterState({ select: (s) => s.status === "pending" });
  const [clicked, setClicked] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
    let t: number | undefined;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest("a[href^='/'], button[type='submit']");
      if (!el || el.closest("[role='dialog']")) return;
      setClicked(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setClicked(false), 700);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.clearTimeout(t);
    };
  }, []);
  // CSR-only routes are pending on the first client render but not in the SSR shell.
  // Keep that first render identical, then show navigation state after hydration.
  if (!hydrated || (!loading && !clicked)) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-background/40 backdrop-blur-[2px]">
      <WorkerLoader size="md" branded={!isPublicSurface(path)} />
    </div>
  );
}
