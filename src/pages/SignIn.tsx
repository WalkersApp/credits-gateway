import { useState } from "react";

import { api } from "../api.js";
import { Field, Notice } from "../components/ui.js";

export function SignIn({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await (mode === "login" ? api.login(email, password) : api.register(email, password));
      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>{mode === "login" ? "Sign in" : "Create a test account"}</h1>
      <p className="lede">
        This gateway runs on Cardano preprod with test funds only. Use a throwaway email — accounts here exist to
        demonstrate the deposit, credit and settlement flow.
      </p>
      <form className="card" onSubmit={submit} style={{ maxWidth: 420 }}>
        <Field label="Email">
          <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <div className="row">
          <button type="submit" disabled={busy}>{mode === "login" ? "Sign in" : "Create account"}</button>
          <button type="button" className="secondary" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "I need an account" : "I already have an account"}
          </button>
        </div>
      </form>
    </>
  );
}
