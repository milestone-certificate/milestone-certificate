import { useWorksRealtime } from "@/components/app/ReceiveStatus";
import { NotificationBell } from "@/components/app/NotificationBell";
import { AgentNotice } from "@/components/app/AgentNotice";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { TechBackground } from "./TechBackground";
import brandLogo from "@/assets/brand-logo.jpg";
import { navigationForRoles } from "@/lib/navigation";
import { cancelStaleSvpBookings } from "@/lib/svp-pending-cancel";
import { useEffect } from "react";
import { MobileNavigation } from "@/components/app/MobileNavigation";
import { roleSummary } from "@/lib/roles";

export function AppShell({ children, roles = [] }: { children: ReactNode; roles?: string[] }) {
  useWorksRealtime();
  const items = navigationForRoles(roles);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Pending SVP bookings expire automatically; sweep at most every five minutes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "svp-pending-sweep";
    const last = Number(window.sessionStorage.getItem(key) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < 5 * 60_000) return;
    window.sessionStorage.setItem(key, String(Date.now()));
    void cancelStaleSvpBookings().then((count) => {
      if (count > 0) {
        void qc.invalidateQueries({ queryKey: ["my-svp-bookings"] });
        void qc.invalidateQueries({ queryKey: ["admin-svp-bookings"] });
      }
    });
  }, [qc]);
  const logout = async () => {
    await qc.cancelQueries();
    await supabase.auth.signOut({ scope: "local" });
    qc.clear();
    navigate({ to: "/auth" });
  };
  return (
    <div className="relative isolate min-h-screen md:flex">
      <TechBackground />
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-hidden border-r bg-sidebar/85 p-4 backdrop-blur-md md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img
            src={brandLogo}
            alt="Milestone Certificate Institute"
            className="h-10 w-10 rounded-full object-cover ring-2 ring-primary/50"
          />
          <div className="font-display text-base font-bold leading-tight">
            Milestone
            <br />
            <span className="text-xs font-medium text-muted-foreground">Certificate</span>
            <span className="mt-1 block text-[10px] font-normal text-primary">
              {roleSummary(roles)}
            </span>
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1">
            {items.map((n) => (
              <Link
                key={n.to}
                to={n.to as "/dashboard"}
                className="group relative flex items-center gap-3 overflow-hidden rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-all duration-300 hover:translate-x-1 hover:border-primary/40 hover:bg-gradient-to-r hover:from-primary/20 hover:to-transparent hover:shadow-[0_0_18px_-4px_color-mix(in_oklab,var(--primary)_70%,transparent)]"
                activeProps={{
                  className:
                    "border-primary/50 bg-gradient-to-r from-primary/25 to-transparent text-sidebar-accent-foreground shadow-[0_0_16px_-5px_color-mix(in_oklab,var(--primary)_80%,transparent)]",
                }}
              >
                <n.icon className="h-4 w-4 transition-transform duration-300 group-hover:scale-125 group-hover:text-primary" />
                {n.label}
              </Link>
            ))}
          </div>
        </nav>
        <button
          onClick={logout}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <LogOut className="h-4 w-4" /> লগআউট
        </button>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-8">
        <div className="mb-4 flex items-center gap-2">
          <img
            src={brandLogo}
            alt=""
            className="h-8 w-8 rounded-full object-cover ring-2 ring-primary/50 md:hidden"
          />
          <span className="font-display text-base font-bold md:hidden">
            Milestone Certificate Institute
          </span>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>
        {roles.includes("agent") && <AgentNotice />}
        {children}
      </main>

      <MobileNavigation roles={roles} onLogout={logout} />
    </div>
  );
}
