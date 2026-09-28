# Roadmap

## M0 — Foundation

- [x] Versioned protocol schemas and deterministic collision rules.
- [x] CI verification and public repository governance files.

## M1 — Working local MVP

- [x] Connect a Git repository with an ignored local configuration.
- [x] Persist live sessions, tasks, leases, messages, events, and collisions.
- [x] Expose a universal stdio MCP server and six coordination tools.
- [x] Auto-start a loopback-only local daemon from an MCP client.
- [x] Deny path writes that overlap another live task scope.
- [x] Show actual state in a read-only dashboard with event-stream updates.
- [x] Test the state engine, HTTP API, MCP surface, CLI activation, and UI contract.

## M2 — Stronger native integrations

- [x] Package the CLI for installation directly from the ATC Git repository.
- [ ] Publish a versioned CLI to a package registry.
- [ ] Install Codex and Claude Code native pre-write hooks automatically.
- [ ] Add post-write filesystem observation for non-hook clients.
- [x] Renew leases while MCP is connected and complete sessions on normal shutdown.

## M3 — Team coordinator

- [x] Add an authenticated self-hosted team coordinator, one-use invitations, and repository membership.
- [ ] Replace the local JSON event log with SQLite and retention controls.
- [ ] Add ordered WebSocket resume and offline event reconciliation.
- [x] Exercise two cloned checkouts with distinct developer credentials and MCP processes against one coordinator.
- [ ] Verify a live deployment across two physical developer machines.

## M4 — Dependency-aware beta

- [ ] Analyze TypeScript/JavaScript imports incrementally.
- [ ] Warn when an active consumer depends on a changing provider.
- [ ] Tune thresholds against privacy-safe recorded metadata fixtures.
- [ ] Publish local and self-hosted installation paths.
