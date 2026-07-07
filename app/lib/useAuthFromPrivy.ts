"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";

// Bridges Privy auth into Convex's ConvexProviderWithAuth.
// Convex calls fetchAccessToken to get the Privy JWT, then verifies it via convex/auth.config.ts.
export function useAuthFromPrivy() {
  const { ready, authenticated, getAccessToken } = usePrivy();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        // Privy refreshes the access token internally; forceRefreshToken is advisory here.
        void forceRefreshToken;
        const token = await getAccessToken();
        return token ?? null;
      } catch {
        return null;
      }
    },
    [getAccessToken]
  );

  return useMemo(
    () => ({
      isLoading: !ready,
      isAuthenticated: ready && authenticated,
      fetchAccessToken,
    }),
    [ready, authenticated, fetchAccessToken]
  );
}
