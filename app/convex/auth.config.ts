// Convex trusts Privy-issued JWTs via the Custom JWT provider.
// Privy access tokens: issuer "privy.io", ES256, `aud` = your Privy app id, JWKS served per-app.
// Set PRIVY_APP_ID in the Convex dashboard (Settings → Environment Variables).
// Architecture spine I1: Convex trusts the consumer surface's Privy JWT via customJwt.

const privyAppId = process.env.PRIVY_APP_ID;
if (!privyAppId) {
  throw new Error("Missing Convex env var PRIVY_APP_ID");
}

type CustomJwtProvider = {
  type: "customJwt";
  applicationID?: string;
  issuer: string;
  jwks: string;
  algorithm: string;
};

const providers: CustomJwtProvider[] = [
  {
    type: "customJwt",
    applicationID: privyAppId, // must equal the token `aud`
    issuer: "privy.io",
    jwks: `https://auth.privy.io/api/v1/apps/${privyAppId}/jwks.json`,
    algorithm: "ES256",
  },
];

// Admin Story 1.1: WorkOS AuthKit is a SECOND Convex auth provider, added ONLY when the deployment
// has a WorkOS tenant configured.
//
// The `"WORKOS_CLIENT_ID" in process.env` membership probe is LOAD-BEARING and must not become a
// plain `process.env.WORKOS_CLIENT_ID` read: Convex rejects a push for ANY env var the auth config
// *reads* but that is unset, so a bare read would force every consumer-only deployment to define a
// WorkOS tenant before it could deploy at all, and would break the test suite. The membership check
// reads nothing unless the var is actually present.
//
// No `applicationID` on this provider: AuthKit access tokens carry no documented `aud`, and Convex
// only enforces `aud` when `applicationID` is set — so setting it would reject every valid token.
if ("WORKOS_CLIENT_ID" in process.env) {
  const workosClientId = process.env.WORKOS_CLIENT_ID;
  providers.push({
    type: "customJwt",
    issuer: `https://api.workos.com/user_management/${workosClientId}`,
    jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
    algorithm: "RS256",
  });
}

const runtimeEnvironment = process.env.VESPER_RUNTIME_ENV;
const devAdminAuthFlag = process.env.VESPER_ENABLE_DEV_ADMIN_AUTH;
const devAdminJwksUrl = process.env.VESPER_DEV_ADMIN_JWKS_URL;
if (runtimeEnvironment === "development" && devAdminAuthFlag === "true" && devAdminJwksUrl) {
  providers.push({
    type: "customJwt",
    applicationID: "vesper-admin-preview",
    issuer: "https://dev-admin.vesper.local",
    jwks: devAdminJwksUrl,
    algorithm: "RS256",
  });
}

const authConfig = { providers };

export default authConfig;
