import { setupCore } from "@convex-dev/auth/core/setup";
import { setupUsernamePasskey } from "@convex-dev/auth/providers/passkey/setup";
import { components, internal } from "./_generated/api";
const core = setupCore({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = core;
const origin = process.env.SITE_URL!;
export const { startSignIn, startAutofillSignIn, finishSignUp, finishSignIn } =
  setupUsernamePasskey(core, {
    component: components.authPasskey,
    usernameComponent: components.authUsername,
    rpId: new URL(origin).hostname,
    origin,
    rpName: "Rehearsal",
  }).attachUserCallbacks({ createUser: internal.users.createPasskeyUser });
