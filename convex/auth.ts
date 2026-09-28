import { setupCore } from "@convex-dev/auth/core/setup";
import { setupUsernamePasskey } from "@convex-dev/auth/providers/passkey/setup";
import { setupGoogle } from "@convex-dev/auth/providers/oauth/google";
import { components, internal } from "./_generated/api";
import { env } from "./_generated/server";
const core = setupCore({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = core;
const origin = env.SITE_URL;
export const { startSignIn, startAutofillSignIn, finishSignUp, finishSignIn } =
  setupUsernamePasskey(core, {
    component: components.authPasskey,
    usernameComponent: components.authUsername,
    rpId: new URL(origin).hostname,
    origin,
    rpName: "Rehearsal",
  }).attachUserCallbacks({ createUser: internal.users.createPasskeyUser });

export const { startSignInGoogle, completeSignInGoogle } = setupGoogle(core, {
  component: components.oauthGoogle,
  allowedRedirectOrigins: [new URL(origin).origin],
}).attachUserCallbacks({
  createUser: internal.users.createGoogleUser,
  onSignIn: internal.users.syncGoogleUser,
});
