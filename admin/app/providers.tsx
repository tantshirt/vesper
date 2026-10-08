"use client";

import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { useAuthFromWorkos } from "@/lib/useAuthFromWorkos";

// Same module-scope client pattern as the consumer app. Both apps point at the SAME
// NEXT_PUBLIC_CONVEX_URL — one shared Convex deployment, two auth providers (Privy + WorkOS).
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function useUnavailableAuth() {
  return {
    isLoading: false,
    isAuthenticated: false,
    fetchAccessToken: async () => null,
  };
}

function useDevAdminAuth() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/dev-auth", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = (await response.json()) as { token?: unknown };
        return typeof body.token === "string" ? body.token : null;
      })
      .then(setToken)
      .catch(() => setToken(null));
  }, []);
  const fetchAccessToken = useCallback(async () => token ?? null, [token]);
  return {
    isLoading: token === undefined,
    isAuthenticated: typeof token === "string",
    fetchAccessToken,
  };
}

export function Providers({
  children,
  workosConfigured,
  devAdminConfigured,
}: {
  children: ReactNode;
  workosConfigured: boolean;
  devAdminConfigured: boolean;
}) {
  if (!workosConfigured && !devAdminConfigured) {
    return (
      <ConvexProviderWithAuth client={convex} useAuth={useUnavailableAuth}>
        {children}
      </ConvexProviderWithAuth>
    );
  }
  if (!workosConfigured) {
    return (
      <ConvexProviderWithAuth client={convex} useAuth={useDevAdminAuth}>
        {children}
      </ConvexProviderWithAuth>
    );
  }
  return (
    // AuthKitProvider must wrap the Convex provider: useAuthFromWorkos reads AuthKit's context.
    <AuthKitProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromWorkos}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
