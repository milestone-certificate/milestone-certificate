import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { NavLoader } from "@/components/app/WorkerLoader";
import { supabase } from "@/integrations/supabase/client";
import { createAuthCacheHandler } from "@/lib/auth-query-cache";
import { resetDeviceCheckCache } from "@/lib/device-session";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">পেজ পাওয়া যায়নি</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          এই ঠিকানায় কোনো পেজ নেই। হোম পেজ থেকে আবার শুরু করুন।
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            হোমে ফিরুন
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          পেজটি লোড করা যায়নি
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          আবার চেষ্টা করুন অথবা হোম পেজে ফিরে যান।
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            আবার চেষ্টা করুন
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            হোমে ফিরুন
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "পরীক্ষার্থী পোর্টাল" },
      { name: "description", content: "পরীক্ষার্থী, পরীক্ষা, রেজাল্ট ও বিশ্লেষণ এক জায়গায়।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/svg+xml", href: "/portal-icon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="bn">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(
      createAuthCacheHandler(
        queryClient,
        () => {
          void router.invalidate();
        },
        resetDeviceCheckCache,
      ),
    );
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  // Deterrent only on the published site: block right-click, devtools shortcuts, view-source and console output.
  // Real data protection is enforced server-side by RLS; this just makes casual inspection harder.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const noop = () => {};
    console.log = noop;
    console.info = noop;
    console.debug = noop;
    console.table = noop;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toUpperCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (
        k === "F12" ||
        (ctrl && e.shiftKey && ["I", "J", "C", "K"].includes(k)) ||
        (ctrl && e.altKey && ["I", "J", "C"].includes(k)) ||
        (ctrl && ["U", "S"].includes(k))
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Copy/select stays allowed — staff need to copy passport, mobile and names.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, []);

  // Every 30s: sign out if the 12h window ended or another device took over this ID.
  useEffect(() => {
    const tick = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        const { checkDeviceSession, forceSignOut } = await import("@/lib/device-session");
        const reason = await checkDeviceSession();
        if (reason) await forceSignOut(reason);
      } catch {
        /* A temporary outage is retried on the next tick; route guards remain closed. */
      }
    };
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <NavLoader />
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  );
}
