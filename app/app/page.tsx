import type { Metadata } from "next";
import { Landing } from "./components/Landing";

// Public marketing landing page (/) — a faithful port of the Brand "Vesper Landing" design.
// Server component for metadata; the interactive body (scroll reveal + count-up) lives in <Landing/>.
export const metadata: Metadata = {
  title: "Vesper — Own the building. Not the mortgage.",
  description:
    "Vesper turns income-producing property into shares you can own from $50. Real buildings, real monthly rent, no landlording.",
};

export default function LandingPage() {
  return <Landing />;
}
