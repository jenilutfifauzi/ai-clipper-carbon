# 0032: Account-scoped data behind Clerk

Status: accepted
Date: 2026-11-03

Builds on 0027 (the Agent behind a scoped MCP server) and 0031 (Generative UI is a scoped MCP tool).

## Context

Clerk sign-in was added to the UI and backend. Before account isolation, Jobs, media, settings, credentials, presets, templates and imported assets all lived in one shared `DATA_DIR`; adding a sign-in screen alone would have exposed one account's data to another. Cloudflare Access remains enabled as an upstream gate during rollout, and public account registration is not enabled by this change.

## Decision

- **The verified Clerk `sub` is the only account identity.** It comes from Clerk's verified session, never from request bodies, query parameters, paths or Agent tool arguments. A signed-in session without a valid subject is rejected.
- **Each account gets a private workspace** at `DATA_DIR/users/<sha256(sub)>/`. The hashed directory avoids putting Clerk identifiers in paths. Jobs and their artifacts, uploaded files, media, profiles, settings and YouTube cookies, API/Agent credentials, presets, templates, export settings, logos, imported fonts/looks, narration files, voice samples, matte state, Agent sessions and related caches are scoped to this workspace.
- **Every access path resolves services through the authenticated workspace.** This includes HTTP routes, media file routes, Agent APIs, background workers, and MCP tool calls. The general `/mcp` tool endpoint verifies Clerk; `/mcp/agent` additionally requires its unguessable Candidate scope, now bound to the same user. Font and Look registries are selected with task-local context, including worker tasks; font metric caches include the workspace file path.
- **The old shared root is legacy and unassigned.** Existing files directly under `DATA_DIR` are neither moved, copied, deleted, nor exposed through any user's workspace. A new account starts with an empty workspace. Do not infer that the first account owns the old data; the owner must explicitly decide on a migration after confirming which Clerk account is theirs.
- **A process retains the original single-heavy-job resource bound.** Each account has an independent queue and stores, while a process-wide lock serializes expensive worker steps. Until a durable cross-process queue/lock is added, run a single backend worker process.
- **Test injection is explicit.** Supplying a Settings object or Ports no longer disables production auth; only the test suite's explicit `test_mode` path creates an unauthenticated isolated workspace.
- **Rollout is not a deployment change.** This ADR does not merge, deploy, alter Cloudflare Access, or enable public signup. Keep Access in place and verify the first owner's Clerk identity before considering legacy-data migration or broader registration.

## Consequences

- The same Job ID or asset ID in another account's directory is not accessible from this account; lookups return only the selected workspace's data.
- Data storage grows per account, and owner-level legacy migration remains a separate, explicit operation.
- A multi-process deployment is not safe for background-job coordination until its worker lock is externalized. Use one backend worker process for this rollout.
