"use client";

import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { useEffect } from "react";

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Vesper admin workspace error", error);
  }, [error]);

  return (
    <main className="admin-route-error">
      <WarningCircle aria-hidden="true" />
      <h1>This workspace could not load</h1>
      <p>Your action was not submitted. Check the connection, then try loading this view again.</p>
      <button type="button" onClick={reset}>
        <ArrowClockwise aria-hidden="true" />
        Try again
      </button>
    </main>
  );
}
