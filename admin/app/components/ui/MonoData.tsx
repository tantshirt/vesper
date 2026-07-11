"use client";

import { useState } from "react";

// MonoData — renders an on-chain identifier (address, tx sig, mint ID, doc hash,
// gate signature) in the mono-data type role: monospace, tabular, ink. The value is
// truncated in the MIDDLE (0x1E1B…4B4B) so both ends stay legible; clicking copies the
// FULL value to the clipboard, and the full value is always available on hover (title)
// and by expanding. An address is never set in a proportional font.

/** Keep `lead` chars at the head and `tail` chars at the tail, eliding the middle. */
export function truncateMiddle(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function MonoData({
  value,
  lead = 6,
  tail = 4,
  label,
}: {
  value: string;
  lead?: number;
  tail?: number;
  /** Accessible name for the copy control (e.g. "mint address"). */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function onClick() {
    setExpanded((e) => !e);
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard may be unavailable (insecure context / permissions) — expanding to
      // reveal the full value is the graceful fallback; never throw at the operator.
    }
  }

  const shown = expanded ? value : truncateMiddle(value, lead, tail);

  return (
    <button
      type="button"
      className={`a-mono${copied ? " is-copied" : ""}${expanded ? " is-expanded" : ""}`}
      onClick={onClick}
      title={value}
      aria-label={`${label ? label + ": " : ""}${value}${copied ? " (copied)" : ""}`}
    >
      <span className="a-mono-value">{shown}</span>
      <span className="a-mono-copy" aria-hidden>
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}
