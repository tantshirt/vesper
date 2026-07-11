"use client";

import { useAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { useCallback, useMemo } from "react";

// Bridges WorkOS AuthKit into Convex's ConvexProviderWithAuth — the admin-side mirror of the
// consumer's useAuthFromPrivy. Convex calls fetchAccessToken to get the WorkOS access token, then
// verifies it against convex/auth.config.ts (the conditional WorkOS provider).
//
// NOTE: live SSO cannot be exercised without a WorkOS tenant; this token-*delivery* path is the one
// surface Story 1.1's tests do not cover. The token-*authorization* decision (the scope wall + RBAC)
// is fully covered by convex/rbac.test.ts, which fakes both issuers.
export function useAuthFromWorkos() {
  const { user, loading: authLoading } = useAuth();
  const { getAccessToken, loading: tokenLoading, error } = useAccessToken();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        // getAccessToken refreshes automatically when stale; forceRefreshToken is advisory here.
        void forceRefreshToken;
        const token = await getAccessToken();
        return token ?? null;
      } catch {
        return null;
      }
    },
    [getAccessToken],
  );

  return useMemo(
    () => ({
      isLoading: authLoading || tokenLoading,
      // Stop reporting authenticated once a token fetch/refresh has errored. An expired or revoked
      // WorkOS session must surface as "sign in again" — NOT leave Convex retry-looping a dead token
      // while the console misreports the state as "no staff access".
      isAuthenticated: Boolean(user) && !error,
      fetchAccessToken,
    }),
    [user, authLoading, tokenLoading, error, fetchAccessToken],
  );
}
