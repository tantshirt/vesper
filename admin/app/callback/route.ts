import { handleAuth } from "@workos-inc/authkit-nextjs";

// WorkOS AuthKit SSO callback. The hosted sign-in flow redirects back here (the URI registered as
// NEXT_PUBLIC_WORKOS_REDIRECT_URI); handleAuth completes the code exchange and establishes the
// session cookie, then redirects into the app. Without this route the "Sign in with SSO" button
// would return to a 404 — so although live SSO is untestable here, the front-door wiring is coherent.
export const GET = handleAuth();
