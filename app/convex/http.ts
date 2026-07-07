import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeHeliusEvent } from "./reconcile";

// E1.3 — the Helius webhook. Served at `<deployment>.convex.site/helius/webhook`. Authenticates the
// callback, normalizes the enriched payload, and dispatches each event to the idempotent
// reconciliation mutation. The secret is a Convex-dashboard env var (see .env.local.example).
const http = httpRouter();

http.route({
  path: "/helius/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.HELIUS_WEBHOOK_SECRET;
    const auth = req.headers.get("authorization");
    if (!secret || !auth || auth !== secret) {
      return new Response("unauthorized", { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    const events = normalizeHeliusEvent(body);
    if (events.length === 0) {
      return new Response("bad request", { status: 400 });
    }

    for (const event of events) {
      await ctx.runMutation(internal.reconcile.applyChainEvent, event);
    }
    return new Response("ok", { status: 200 });
  }),
});

export default http;
