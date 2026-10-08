import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeHeliusEvent } from "./reconcile";

// E1.3 — the Helius webhook. Served at `<deployment>.convex.site/helius/webhook`. Authenticates the
// callback, normalizes the enriched payload, and dispatches each event to the idempotent
// reconciliation mutation. The secret is a Convex-dashboard env var (see .env.local.example).
const http = httpRouter();
export const MAX_WEBHOOK_BYTES = 1_000_000;

http.route({
  path: "/dev-admin-jwks",
  method: "GET",
  handler: httpAction(async () => {
    if (
      process.env.VESPER_RUNTIME_ENV !== "development" ||
      process.env.VESPER_ENABLE_DEV_ADMIN_AUTH !== "true" ||
      !process.env.VESPER_DEV_ADMIN_PUBLIC_JWK
    ) {
      return new Response("not found", { status: 404 });
    }
    try {
      const key = JSON.parse(process.env.VESPER_DEV_ADMIN_PUBLIC_JWK) as unknown;
      return Response.json({ keys: [key] }, {
        headers: { "cache-control": "public, max-age=300" },
      });
    } catch {
      return new Response("invalid development key", { status: 500 });
    }
  }),
});

function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function readJsonBody(req: Request): Promise<{ body?: unknown; status?: number }> {
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) return { status: 400 };
    if (contentLength > MAX_WEBHOOK_BYTES) return { status: 413 };
  }
  if (!req.body) return { status: 400 };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      return { status: 413 };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { body: JSON.parse(new TextDecoder().decode(body)) };
  } catch {
    return { status: 400 };
  }
}

http.route({
  path: "/helius/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.HELIUS_WEBHOOK_SECRET;
    const auth = req.headers.get("authorization");
    if (!secret || !auth || !constantTimeEqual(auth, secret)) {
      return new Response("unauthorized", { status: 401 });
    }
    const parsed = await readJsonBody(req);
    if (parsed.status) {
      return new Response(parsed.status === 413 ? "payload too large" : "bad request", {
        status: parsed.status,
      });
    }

    const events = normalizeHeliusEvent(parsed.body);
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
