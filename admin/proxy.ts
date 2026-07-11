import { NextResponse } from "next/server";
import type { NextRequest, NextFetchEvent } from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

// Story 1.1: the AuthKit gate, on Next 16's `proxy` file convention (the former `middleware`, which
// is deprecated and warns on every build). `/console/*` requires a WorkOS session; `/` stays public.
//
// Degrade coherently when the WorkOS env is absent: the signed-out landing claims to work without
// credentials, so the gate must NOT 500 every route when unconfigured — it passes requests through
// instead. authkitMiddleware is constructed only when the required env is present.
const workosConfigured = Boolean(
  process.env.WORKOS_API_KEY && process.env.WORKOS_CLIENT_ID && process.env.WORKOS_COOKIE_PASSWORD,
);

const authed = workosConfigured
  ? authkitMiddleware({ middlewareAuth: { enabled: true, unauthenticatedPaths: ["/"] } })
  : null;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!authed) return NextResponse.next();
  return authed(request, event);
}

export const config = {
  // Run on the public landing (so an existing session is recognized) and gate the console subtree.
  matcher: ["/", "/console/:path*"],
};
