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
  title: "Vesper — Own the building. Not the mortgage.",
  description: "Own real estate income, quietly.",
  icons: {
    icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/brand/app-icon.svg" }],
  },
};

export const viewport: Viewport = {
  // Light-first only — no dark mode. Chrome color mirrors --bg.
  colorScheme: "light",
  themeColor: "#FBFBFD", /* token-guard-allow */
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
