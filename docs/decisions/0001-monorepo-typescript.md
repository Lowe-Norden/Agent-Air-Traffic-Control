# ADR 0001: TypeScript monorepo for v0

- Status: accepted
- Date: 2026-09-17

## Decision

Use a pnpm TypeScript monorepo for the v0 protocol, daemon, coordinator, adapters, and web application.

## Rationale

A shared language makes the wire contract directly consumable across every initial component and keeps the first contributor path simple. Node's ecosystem is sufficient for filesystem observation, Git integration, WebSockets, SQLite, MCP, and the web UI.

## Consequences

We optimize for shipping and protocol consistency rather than a prematurely lower-level daemon. A later native component remains possible if measurement shows Node is inadequate.

