# Rehearsal on Omnara

The existing **Fable** profile and session use `.omnara/rehearsal.json`.
They run in an Omnara cloud sandbox, separate from this local checkout.

- Project: `proj_agqmbufoqj3h7kajjluooazgzm`
- Profile: `aprf_agqmpjjvzfzbjeotlv4bira7we`
- [Existing session](https://app.omnara.com/projects/proj_agqmbufoqj3h7kajjluooazgzm/agents/agt_agqmpjjwpn3xna22iufobhx7vi)

## Git access

The profile injects `REHEARSAL_GITHUB_SSH_KEY` from an Omnara project secret.
Its corresponding GitHub deploy key grants read/write access only to
`atarantino/rehearsal`. No GitHub MCP is required for Git operations.

Install `openssh-client` in fresh sandboxes first (`apk add --no-cache openssh-client`
on Alpine). From a cloud checkout, run:

```bash
bash scripts/setup-omnara-git.sh
git push --dry-run origin HEAD
```

The profile includes the same bootstrap so it works before this script is
committed. It preserves HTTPS fetching and configures SSH pushing over port 443,
with GitHub host keys pinned from `https://api.github.com/meta` during setup.
The private key is written only to the sandbox user's `.ssh` directory.
Never print the environment variable or commit private keys.

A deploy key does not authenticate `gh` for opening PRs or accessing GitHub APIs.
Those operations need separate GitHub API credentials or an authenticated MCP.
The unrelated **General agent** profile is unchanged.

## Updating the profile

Omnara CLI login and default project are configured on this machine. To apply
changes to the saved profile:

```bash
npx omnara profiles update aprf_agqmpjjvzfzbjeotlv4bira7we --file .omnara/rehearsal.json
```

Existing sessions retain their config until explicitly updated:

```bash
npx omnara agents update agt_agqmpjjwpn3xna22iufobhx7vi --file .omnara/rehearsal.json
```

Only secret references, not credential values, are saved in these files.
`setup-metadata.json` records IDs for maintenance. Revoke access by deleting the
GitHub deploy key named **Omnara rehearsal cloud agent** in the repository's
Settings → Deploy keys. For rotation, replace both the GitHub public key and
Omnara secret value, then rerun the bootstrap in existing sandboxes.

Docs: https://docs.omnara.com/agents/configuration

## Verified setup

The existing Fable sandbox passed `git push --dry-run origin HEAD` with exit code 0
on 2026-09-22 UTC, showing `d97e310..4156e1a HEAD -> main`. No commits were
published by this setup. GitHub authentication works; actual pushes still follow
GitHub branch rules and the current remote history.

## MCP connections

The Fable profile and existing session now include three deferred MCP servers.
Fable loads their tools through `tool_search` when needed.

| Server | Endpoint | Access |
| --- | --- | --- |
| Firecrawl | `https://mcp.firecrawl.dev/v2/mcp` | Existing API key stored as a project secret; routine scrape/search/map and status reads allowed; other operations ask |
| AgentMail | `https://mcp.agentmail.to/mcp` | Existing API key stored as a project secret; list/get/search allowed; writes, sends, and deletes ask |
| Convex guidance | `https://mcp.convex.dev/mcp` | No authentication; development and scaling guidance |

The hosted Convex server does **not** expose deployment tables, logs, or function
execution. Those require the separate local Convex deployment MCP/CLI and a chosen
deployment credential. No production MCP access was enabled by this setup.

The Firecrawl and AgentMail keys remain in Omnara Secrets. The config contains
only secret IDs, never key values. Although AgentMail documents API keys using
`x-api-key`, its current endpoint also accepted bearer authentication during
Omnara tool discovery, which is the authentication mode configured here.

Sources: [Omnara MCP configuration](https://docs.omnara.com/tools/mcp),
[Firecrawl MCP](https://docs.firecrawl.dev/mcp-server),
[AgentMail MCP](https://www.agentmail.to/docs/integrations/mcp),
[Convex hosted MCP](https://mcp.convex.dev/).

Verified from the existing Fable session on 2026-09-22 UTC: deferred tool search
worked for all three servers; AgentMail `list_inboxes(limit=1)`, Firecrawl
`firecrawl_credit_usage(view="current")`, and Convex
`get_convex_scaling_guidance` all succeeded. No email was sent and no app data
was changed during verification.
