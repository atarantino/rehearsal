# Google sign-in

Rehearsal uses the Google provider included in Convex Auth `2.0.0-alpha.1`.
The OAuth component handles the callback and token exchange; the browser uses
`useSignInWithGoogle`. Requested scopes are `openid email profile`.

## Google Cloud configuration

Use a dedicated Rehearsal project and a **Web application** OAuth client.
The configured Cloud project is `lunar-tube-510001-p0` (display name Rehearsal).
Configure the consent screen with Rehearsal branding and an External audience.
The Google project remains in Testing. For the identity-only scopes used here,
Google explicitly allows sign-in without adding test users and without the
seven-day authorization expiry. This exception stops applying if other scopes
are added. See [Google's audience documentation](https://support.google.com/cloud/answer/15549945).

Authorized redirect URIs:

- Development: `https://quick-starfish-327.convex.site/oauth/google/callback`
- Production: `https://acoustic-cuttlefish-868.convex.site/oauth/google/callback`

Separate clients for development and production keep their credentials isolated.
Both clients are configured, with their credentials stored on the corresponding
Convex deployments. Local credential downloads are kept outside the repository
in `~/.config/rehearsal-oauth/` with owner-only permissions.
The redirect URI is the Convex **site** URL, with the v2 component's
`/oauth/google/callback` path. The older Convex Auth v1 callback path does not apply.

Set `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET` on each corresponding
Convex deployment before deploying this change. Keep the secret out of Git,
frontend environment variables, and command output. The OAuth component requires
both values. Existing auth signing keys stay in place.

Download the Web client's JSON from Google and import it without printing secrets:

```sh
node scripts/configure-google-auth.mjs --deployment=quick-starfish-327 --client=/absolute/path/to/client.json
```

Use the production client download and `--deployment=acoustic-cuttlefish-868` for
production. The script checks the callback URL and pipes values to Convex through
stdin. Keep downloaded credential files outside the repository.

`SITE_URL` must be the frontend origin. It controls both the passkey origin and
the Google post-login redirect allowlist. Development currently uses
`http://localhost:4319`; run Vite with `npm run dev -- --port 4319` for that
configuration. Production uses `https://acoustic-cuttlefish-868.convex.site`.

## Account behavior and verification

Google's stable subject identifies returning Google users through the auth
component. Names and email addresses never merge accounts. Existing passkey
users must continue using their passkey to access their existing workspace;
account linking is not implemented.

After configuration, deploy the backend and frontend, then verify:

1. Continue with Google returns to an authenticated workspace.
2. Sign out and repeat with the same Google account; its workspace persists.
3. Cancel at Google; Rehearsal shows a retryable error.
4. Existing passkey sign-in still opens the original workspace.

Backend tests cover account separation, missing optional profile fields,
redirect-origin validation, and invalid callback tickets.

Verified on 2026-09-27: real Google sign-in completed on development and
production, returning Google sign-in did not create another development user,
the existing production session remained valid after deployment, and the live
HTML matched the production build. Build, 126 unit/backend tests, and 27 browser
tests passed. Cancellation and a new passkey ceremony were not manually retested.

Google shows the Convex site domain on the consent screen until the app's brand
is verified. Displaying the Rehearsal name/logo requires a separate branding
verification process, including a verified owned domain and application policy
links. See [Google's branding documentation](https://support.google.com/cloud/answer/15549049).
