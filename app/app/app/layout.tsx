import { AppShell } from "../components/AppShell";

// Layout for the authenticated app segment (/app/*). Wraps every screen in the shared
// responsive shell: desktop left sidebar, mobile bottom tab bar.
export default function AppSegmentLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
