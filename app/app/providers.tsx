"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";
import { useAuthFromPrivy } from "@/lib/useAuthFromPrivy";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        // Consumer surface: passkey-first, crypto invisible (spine I6 / NFR3).
        loginMethods: ["email", "sms", "passkey", "wallet"],
        embeddedWallets: {
          // Pre-generate a self-custodial Solana wallet for users without one (FR4).
          solana: { createOnLogin: "users-without-wallets" },
        },
        appearance: {
          theme: "light",
          accentColor: "#3F3D9E", /* token-guard-allow */ // Privy needs a literal; mirrors --accent
          logo: undefined,
        },
      }}
    >
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromPrivy}>
        {children}
      </ConvexProviderWithAuth>
    </PrivyProvider>
  );
}
