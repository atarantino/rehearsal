/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { registerOauth } from "@convex-dev/auth/providers/testing/oauth";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => vi.unstubAllEnvs());

describe("Google sign-in", () => {
  it("creates a private workspace without merging a matching passkey name", async () => {
    const t = convexTest(schema, modules);
    const passkeyId = await t.mutation(internal.users.createPasskeyUser, {
      provider: "passkey",
      providerAccountId: "passkey-1",
      profile: { username: "Alice" },
    });
    const googleId = await t.mutation(internal.users.createGoogleUser, {
      provider: "google",
      providerAccountId: "google-1",
      profile: {
        id: "google-1",
        name: "Alice",
        email: "alice@example.com",
        emailVerified: true,
      },
    });
    expect(googleId).not.toBe(passkeyId);
    await expect(
      t.withIdentity({ subject: googleId }).query(api.users.me, {}),
    ).resolves.toEqual({ username: "Alice" });
    await expect(t.query(api.users.me, {})).rejects.toThrow("Sign in");
  });

  it("accepts a Google profile without optional display fields", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.mutation(internal.users.createGoogleUser, {
      provider: "google",
      providerAccountId: "google-2",
      profile: { id: "google-2", emailVerified: false },
    });
    await expect(
      t.withIdentity({ subject: userId }).query(api.users.me, {}),
    ).resolves.toEqual({ username: null });
  });

  it("stores only a Google-verified email and refreshes it on sign-in", async () => {
    const t = convexTest(schema, modules);
    const profile = {
      id: "google-3",
      email: "bob@example.com",
      emailVerified: false,
    };
    const userId = await t.mutation(internal.users.createGoogleUser, {
      provider: "google",
      providerAccountId: "google-3",
      profile,
    });
    const sync = (p: typeof profile) =>
      t.mutation(internal.users.syncGoogleUser, {
        provider: "google",
        providerAccountId: "google-3",
        profile: p,
        userId,
      });
    const email = () =>
      t.run(async (ctx) => (await ctx.db.get(userId))?.email ?? null);
    await sync(profile);
    expect(await email()).toBeNull();
    await sync({ ...profile, emailVerified: true });
    expect(await email()).toBe("bob@example.com");
    await sync({ ...profile, email: "bob@new.example", emailVerified: true });
    expect(await email()).toBe("bob@new.example");
    await sync(profile);
    expect(await email()).toBeNull();
  });

  it("rejects redirects outside the configured frontend origin", async () => {
    vi.stubEnv("SITE_URL", "http://localhost:4319");
    const t = convexTest(schema, modules);
    for (const redirectTo of [
      "https://attacker.example/",
      "http://localhost:4319.attacker.example/",
      "javascript:alert(1)",
    ]) {
      await expect(
        t.mutation(api.auth.startSignInGoogle, { redirectTo }),
      ).rejects.toThrow(/allowedRedirectOrigins|absolute URL/);
    }
  });

  it("does not authenticate an invented callback ticket", async () => {
    vi.stubEnv("SITE_URL", "http://localhost:4319");
    const t = convexTest(schema, modules);
    registerOauth(t, "oauthGoogle");
    await expect(
      t.mutation(api.auth.completeSignInGoogle, {
        code: "invented-ticket",
        state: "invented-state",
      }),
    ).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  });
});
