import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { devAdminAuthConfigured, workosAuthConfigured } from "@/lib/authConfig";

// The fonts are BYTE COPIES of app/public/fonts/*.woff2 (next/font/local needs the file physically
// present in this app's tree to hash + self-host it; it cannot resolve a font through a package
// import). Because they are copies they CAN drift from the consumer's originals — if the consumer's
// font files are ever replaced, re-copy these. (The CSS tokens, by contrast, are imported, not
// copied, so they cannot drift.)
const fraunces = localFont({
  src: "../public/fonts/fraunces-variable.woff2",
  variable: "--font-serif",
  display: "swap",
  weight: "100 900",
  fallback: ["Hoefler Text", "Georgia", "serif"],
});

const inter = localFont({
  src: "../public/fonts/inter-variable.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Vesper Admin",
  description: "Vesper admin & supply control plane.",
};

export const viewport: Viewport = {
  // Light-first only — no dark mode, matching the consumer surface. Chrome color mirrors --bg.
  colorScheme: "light",
  themeColor: "#FBFBFD", /* token-guard-allow */
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const workosConfigured = workosAuthConfigured();
  const devAdminConfigured = devAdminAuthConfigured();
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <Providers workosConfigured={workosConfigured} devAdminConfigured={devAdminConfigured}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
