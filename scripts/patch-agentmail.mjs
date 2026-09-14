// @agentmail/convex 0.1.0 predates component env isolation in Convex 1.44.
// Declare the existing secret read in its component schema, so the app can
// pass it through typed env bindings instead of exposing it in function args.
import fs from "node:fs";
const root = "node_modules/@agentmail/convex";
const pkg = JSON.parse(fs.readFileSync(`${root}/package.json`, "utf8"));
if (pkg.version !== "0.1.0")
  throw new Error(
    "Review the AgentMail env patch before upgrading the component.",
  );
for (const path of [
  "src/component/convex.config.ts",
  "dist/component/convex.config.js",
]) {
  const file = `${root}/${path}`;
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes("AGENTMAIL_API_KEY")) {
    text = text
      .replace(
        "import { defineComponent }",
        'import { v } from "convex/values";\nimport { defineComponent }',
      )
      .replace(
        'defineComponent("agentmail")',
        'defineComponent("agentmail", { env: { AGENTMAIL_API_KEY: v.string(), AGENTMAIL_BASE_URL: v.optional(v.string()) } })',
      );
    fs.writeFileSync(file, text);
  }
}
fs.writeFileSync(
  `${root}/dist/component/convex.config.d.ts`,
  'declare const component: import("convex/server").ComponentDefinition<any, { readonly AGENTMAIL_API_KEY: import("convex/values").VString<string, "required">; readonly AGENTMAIL_BASE_URL: import("convex/values").VString<string | undefined, "optional">; }>;\nexport default component;\n',
);
console.log("AgentMail component env compatibility patch applied.");
// 0.1.0 marked client-callable component functions internal. Current Convex
// exports only public component functions to the parent app (never browsers).
const exposed = [
  "createInbox",
  "deleteInbox",
  "getInboxRemote",
  "getMessage",
  "getThread",
  "listInboxes",
  "listThreads",
];
for (const path of ["src/component/lib.ts", "dist/component/lib.js"]) {
  const file = `${root}/${path}`;
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes("action as componentAction"))
    text =
      'import { action as componentAction } from "./_generated/server.js";\n' +
      text;
  for (const name of exposed)
    text = text.replace(
      `export const ${name} = internalAction(`,
      `export const ${name} = componentAction(`,
    );
  fs.writeFileSync(file, text);
}
