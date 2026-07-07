import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";

// Self-hosted variable fonts (same-origin, no runtime CDN request).
// Fraunces carries the optical-sizing (opsz) axis; Inter is the variable weight file.
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
  title: "Vesper",
  description: "Own real estate income, quietly.",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    // Browser chrome color; must be a literal string (mirrors the light/dark --bg tokens).
    { media: "(prefers-color-scheme: light)", color: "#FBFBFD" }, /* token-guard-allow */
    { media: "(prefers-color-scheme: dark)", color: "#141033" }, /* token-guard-allow */
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
