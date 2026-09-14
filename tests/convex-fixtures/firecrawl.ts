// Copied into .agent/*/convex by the harness; never part of a normal deploy.
export class FirecrawlClient {
  constructor(_component: unknown) {}
  async scrape(_ctx: unknown, url: string, _options: unknown) {
    if (url.includes("unreadable"))
      throw new Error("Fixture: source unavailable");
    return {
      markdown:
        "Acme seeks a Product designer to lead accessible product launches.",
      metadata: { title: "Product designer at Acme" },
    };
  }
  async search(_ctx: unknown, _query: string, _options: unknown) {
    return { web: [] as Array<{ url: string; title: string }> };
  }
}
