# Agent Air Traffic Control

Real-time, local-first coordination for teams running multiple coding agents against the same codebase.

> Git tells agents what happened. Agent Air Traffic Control tells them what is happening.

ATC connects a Git project to one local coordination service. Agents use a universal MCP server to announce work, inspect other active tasks, check a path before editing, exchange coordination messages, and release their scope. Humans get a live, read-only radar and audit log.

## Working MVP

The repository now contains a complete local vertical slice:

- `atc enable` creates a private project identity and ready-to-copy MCP configuration;
- the MCP server starts the local daemon automatically;
- sessions and task scopes use 90-second renewable leases;
- `check_write` deterministically denies edits inside another active agent's scope;
- agents can send direct or broadcast coordination messages;
- state is persisted atomically in the ignored `.atc/state.json` file;
- the dashboard updates over server-sent events without polling or seeded demo data; and
- only metadata is stored—never source, prompts, transcripts, secrets, or command output.

## Quick start

Prerequisites: Node.js 22+, pnpm 10+, and an MCP-capable coding agent.

```bash
pnpm install
pnpm check
pnpm test

node packages/cli/cli.mjs install
cd /path/to/your/project
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs enable
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs connect
```

Copy the printed `agent-air-traffic-control` MCP server entry into Codex, Claude Code, Cursor, or another MCP client. The first MCP call starts the daemon automatically. To run it explicitly:

```bash
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Agent contract

Each agent follows the same six-tool loop:

1. `begin_task` with a concise summary and repository-relative scopes.
2. `get_airspace` when shared context is needed.
3. `check_write` immediately before changing a file.
4. `heartbeat` at least once per minute during long tasks.
5. `message_agent` when a dependency or collision needs coordination.
6. `complete_task` to close the session and release its scope.

MCP integrations are cooperative: they can return a clear denial and model-ready explanation, but only a native pre-write hook can physically prevent a write. The UI reports the actual capability; it does not claim universal enforcement.

## Development

```bash
pnpm check
pnpm test
pnpm build
```

See [docs/architecture.md](docs/architecture.md), [docs/onboarding.md](docs/onboarding.md), and [docs/product-spec.md](docs/product-spec.md).

## Design principles

- **No human status reporting.** Agents maintain their own session and task state.
- **Read-only radar.** The dashboard observes; agents coordinate through ATC.
- **Leases, not locks.** Claims expire when heartbeats stop.
- **Fail open.** An unavailable coordinator must not make a repository unusable.
- **Metadata only.** Repository contents and conversations stay out of ATC state.
- **Capability honesty.** MCP cooperation and native enforcement are shown distinctly.

Apache-2.0 licensed. See [LICENSE](LICENSE).
