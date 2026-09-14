import type { Page } from "@playwright/test";
export async function virtualPasskey(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}
export async function signIn(page: Page, username: string) {
  await page.getByLabel("Choose a username", { exact: false }).fill(username);
  await page.getByRole("button", { name: "Continue with a passkey" }).click();
}
