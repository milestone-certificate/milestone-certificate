import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/svp-results")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
        if (!token || token.length < 32) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: valid } = await supabaseAdmin.rpc("verify_cron_token", {
          _name: "svp_results",
          _token: token,
        });
        if (valid !== true) return new Response("Unauthorized", { status: 401 });
        try {
          const { runSvpAutoResults } = await import("@/lib/svp-result-automation.server");
          return Response.json(await runSvpAutoResults());
        } catch {
          return Response.json(
            { ok: false, message: "Automatic results temporarily unavailable" },
            { status: 503 },
          );
        }
      },
    },
  },
});
