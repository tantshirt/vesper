// Convex trusts Privy-issued JWTs via the Custom JWT provider.
// Privy access tokens: issuer "privy.io", ES256, `aud` = your Privy app id, JWKS served per-app.
// Set PRIVY_APP_ID in the Convex dashboard (Settings → Environment Variables).
// Architecture spine I1: Convex trusts the consumer surface's Privy JWT via customJwt.

const privyAppId = process.env.PRIVY_APP_ID;
if (!privyAppId) {
  throw new Error("Missing Convex env var PRIVY_APP_ID");
}

const authConfig = {
  providers: [
    {
      type: "customJwt",
      applicationID: privyAppId, // must equal the token `aud`
      issuer: "privy.io",
      jwks: `https://auth.privy.io/api/v1/apps/${privyAppId}/jwks.json`,
      algorithm: "ES256",
    },
  ],
};

export default authConfig;
