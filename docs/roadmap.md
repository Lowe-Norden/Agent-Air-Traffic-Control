# Roadmap

## M0 — Foundation

- [x] Define product, privacy, and architecture contracts.
- [x] Create versioned protocol schemas.
- [x] Implement deterministic path and symbol collision scoring.
- [ ] Publish automated checks in CI.

## M1 — Local proof

- [ ] Detect Git repository, branch, remote fingerprint, and worktree.
- [ ] Observe file writes with debounce.
- [ ] Start sessions and renew leases locally.
- [ ] Expose the minimal MCP tools.
- [ ] Demonstrate two local agents and a same-file warning.

## M2 — Shared airspace

- [ ] Add the single-process coordinator and SQLite event log.
- [ ] Implement snapshot plus sequenced WebSocket resume.
- [ ] Queue offline events and reconcile reconnects.
- [ ] Demonstrate two machines in one repository.

## M3 — Agent integrations

- [ ] Ship the Claude Code adapter.
- [ ] Ship the Codex adapter.
- [ ] Add capability negotiation and `atc doctor`.
- [ ] Verify warnings reach the agent at the strongest supported boundary.

## M4 — Live UI

- [ ] Build presence, task, scope, and collision views.
- [ ] Show protection level and attribution confidence.
- [ ] Add a filtered event timeline.

## M5 — Dependency-aware beta

- [ ] Analyze TypeScript/JavaScript imports incrementally.
- [ ] Detect changed-provider/active-consumer risk.
- [ ] Tune thresholds against recorded metadata fixtures.
- [ ] Publish local and self-hosted installation paths.

