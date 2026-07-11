"use client";

import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";
import { useAuthFromWorkos } from "@/lib/useAuthFromWorkos";

// Same module-scope client pattern as the consumer app. Both apps point at the SAME
// NEXT_PUBLIC_CONVEX_URL — one shared Convex deployment, two auth providers (Privy + WorkOS).
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: ReactNode }) {
  return (
    // AuthKitProvider must wrap the Convex provider: useAuthFromWorkos reads AuthKit's context.
    <AuthKitProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromWorkos}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
