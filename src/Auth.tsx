import { useState, type ReactNode } from "react";
import {
  ConvexAuthProvider,
  useAuthActions,
  useConvexAuth,
} from "@convex-dev/auth/react";
import { usePasskey } from "@convex-dev/auth/providers/passkey/react";
import { AudioLines, KeyRound, ArrowRight } from "lucide-react";
import { api } from "../convex/_generated/api";
import { convex } from "./convex";
export function AuthRoot({ children }: { children: ReactNode }) {
  if (!convex)
    return (
      <div className="auth-page">
        <h1>Rehearsal needs a connection.</h1>
        <p>Configure VITE_CONVEX_URL, then restart the app.</p>
      </div>
    );
  return (
    <ConvexAuthProvider client={convex} api={api.auth}>
      <Gate>{children}</Gate>
    </ConvexAuthProvider>
  );
}
function Gate({ children }: { children: ReactNode }) {
  const auth = useConvexAuth();
  if (auth.isLoading)
    return <div className="auth-page">Opening your workspace…</div>;
  return auth.isAuthenticated ? <>{children}</> : <SignIn />;
}
function SignIn() {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const { signIn, pending } = usePasskey(api.auth, { autofill: false });
  return (
    <div className="auth-page">
      <div className="auth-card">
        <span className="brand">
          <AudioLines /> rehearsal.
        </span>
        <p className="eyebrow">YOUR NEXT INTERVIEW STARTS HERE</p>
        <h1>
          Turn an opportunity
          <br />
          <span>into a stronger answer.</span>
        </h1>
        <p>
          Forward your invitation or paste a job link. Get a sourced brief,
          practice out loud, and try a better answer.
        </p>
        <ol className="auth-steps">
          <li>Know the role.</li>
          <li>Tell your story.</li>
          <li>Hear what changed.</li>
        </ol>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const r = await signIn({ username: username.trim() });
            if (!r.success)
              setError(
                r.userError.error === "CEREMONY_ABORTED"
                  ? "Passkey sign-in was canceled. Try again when you’re ready."
                  : "Sign-in did not finish. Use a username with letters, numbers, or underscores and try again.",
              );
          }}
        >
          <label htmlFor="username">
            Choose a username, or enter yours to return
          </label>
          <input
            id="username"
            autoComplete="username webauthn"
            required
            minLength={3}
            maxLength={40}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Your practice name"
          />
          <button className="primary" disabled={pending}>
            <KeyRound size={18} />
            {pending ? "Waiting for your passkey…" : "Continue with a passkey"}
            <ArrowRight size={18} />
          </button>
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
        </form>
        <p className="privacy-copy">
          No invitation required. Your transcripts and preparation stay in your
          private account. Voice and written coaching use OpenAI; research uses
          Firecrawl; forwarded email uses AgentMail. Rehearsal does not save
          audio.
        </p>
        <p className="privacy-copy">
          Use a passkey-capable browser and device. Keep your passkey: account
          recovery is not available yet.
        </p>
      </div>
    </div>
  );
}
export function SignOut({ disabled = false }: { disabled?: boolean }) {
  const { signOut } = useAuthActions();
  return (
    <button
      className="text-button"
      disabled={disabled}
      onClick={() => void signOut()}
    >
      Sign out
    </button>
  );
}
