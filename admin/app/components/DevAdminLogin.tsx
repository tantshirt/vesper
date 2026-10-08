"use client";

import { useState } from "react";

export function DevAdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <main className="admin-centered-state">
      <form
        className="card inv-form"
        style={{ width: "min(100%, 420px)" }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting) return;
          setSubmitting(true);
          setError(null);
          try {
            const response = await fetch("/api/dev-auth", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ password }),
            });
            if (!response.ok) {
              setError(response.status === 401 ? "Incorrect preview password." : "Preview sign-in is unavailable.");
              return;
            }
            window.location.reload();
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <p className="admin-eyebrow">Development preview</p>
        <h1>Vesper Admin</h1>
        <p>This local profile uses the normal Convex permission checks with a development-only identity.</p>
        <label className="inv-field">
          <span className="inv-label">Preview password</span>
          <input className="inv-input" type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="cta" type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Open preview"}
        </button>
      </form>
    </main>
  );
}
