import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { LogOut, Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { navigationForRoles } from "@/lib/navigation";
import { roleSummary } from "@/lib/roles";

export function MobileNavigation({
  roles,
  onLogout,
}: {
  roles: string[];
  onLogout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const items = navigationForRoles(roles);
  const primary = items.filter((item) => !item.desktopOnly).slice(0, 4);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <nav
        aria-label="মোবাইল নেভিগেশন"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${primary.length + 1},minmax(0,1fr))` }}
        >
          {primary.map((item) => (
            <Link
              key={item.to}
              to={item.to as "/dashboard"}
              className="flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-3 text-[10px] text-muted-foreground"
              activeProps={{ className: "text-primary font-semibold" }}
            >
              <item.icon className="size-5" aria-hidden="true" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          ))}
          <SheetTrigger
            className="flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-3 text-[10px] text-muted-foreground"
            aria-label="সব পেজ ও লগআউট"
          >
            <Menu className="size-5" aria-hidden="true" />
            আরও
          </SheetTrigger>
        </div>
      </nav>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="text-left">সব পেজ</SheetTitle>
        <SheetDescription className="mt-1 text-left">{roleSummary(roles)}</SheetDescription>
        <nav aria-label="সব পেজ" className="mt-4 grid grid-cols-2 gap-2">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to as "/dashboard"}
              onClick={() => setOpen(false)}
              className="flex min-w-0 items-center gap-2 rounded-xl border p-3 text-sm text-foreground"
              activeProps={{ className: "border-primary bg-primary/10 text-primary" }}
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{item.label}</span>
            </Link>
          ))}
        </nav>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onLogout();
              setOpen(false);
            } finally {
              setBusy(false);
            }
          }}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm text-muted-foreground disabled:opacity-50"
        >
          <LogOut className="size-4" />
          {busy ? "লগআউট হচ্ছে…" : "লগআউট"}
        </button>
      </SheetContent>
    </Sheet>
  );
}
