"use client";

import { useState } from "react";

type State = { kind: "idle" | "busy" | "done" | "error"; message?: string };

export function SubscribeForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), website: form.get("website") }),
      });
      const body = (await res.json()) as { message?: string };
      setState({ kind: res.ok ? "done" : "error", message: body.message });
    } catch {
      setState({ kind: "error", message: "Something went wrong. Try again in a moment." });
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="form-row">
        <div className="field">
          <label htmlFor="email">Your email</label>
          <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.in" />
        </div>
        {/* Honeypot: people never see or fill this. */}
        <div className="hp" aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <button type="submit" className="button" disabled={state.kind === "busy"}>
          {state.kind === "busy" ? "Adding…" : "Subscribe"}
        </button>
      </div>
      <p className="form-note" role="status" aria-live="polite">
        {state.message ?? "Free. One email a week. Unsubscribe in one click."}
      </p>
    </form>
  );
}
