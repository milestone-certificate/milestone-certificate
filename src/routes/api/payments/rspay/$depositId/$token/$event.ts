import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/payments/rspay/$depositId/$token/$event")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        // Never log this route's URL: it contains an order-specific callback capability.
        if (!request.headers.get("content-type")?.includes("application/json"))
          return new Response(null, { status: 415 });
        const { readBoundedJson } = await import("@/lib/bounded-json");
        const body = await readBoundedJson(new Response(request.body), 16_384);
        if (!body) return new Response(null, { status: 400 });
        try {
          const { processRspayCallback } = await import("@/lib/rspay.server");
          const status = await processRspayCallback(
            params.depositId,
            params.token,
            params.event,
            body,
          );
          return Response.json(
            { ok: status === 200 },
            { status, headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json({ ok: false }, { status: 503 });
        }
      },
    },
  },
});
