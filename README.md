# Agent Air Traffic Control

Real-time coordination for teams running multiple coding agents against the same codebase.

> Git tells agents what happened. Agent Air Traffic Control tells them what is happening.

ATC connects a Git project to one local coordination service. Agents use a universal MCP server to announce work, inspect other active tasks, check a path before editing, exchange coordination messages, and release their scope. Humans get a live, read-only radar and audit log.

## Team setup

ATC can run on a server you control. The coordinator serves the shared API and read-only Flight Radar from the same process. It needs no AWS deployment or GitHub API calls during normal operation. The server must stay reachable by each developer machine.

Install Node.js 22+ and the ATC CLI once on the coordinator and each developer machine. After this branch is merged, the Git repository itself can supply the package; no registry publication is required:

```bash
npm install -g git+https://github.com/Lowe-Norden/Agent-Air-Traffic-Control.git
```

From your target Git repository, initialize its tracked team identity:

```bash
atc team init --url https://atc.example.internal
git add .atc-team.json .gitignore
```

The owner runs the coordinator from that checkout. By default it listens only on `127.0.0.1:3200`; put an existing HTTPS reverse proxy in front of it. Direct network binding requires `--cert` and `--key`. Keep the coordinator process running with your normal service manager.

```bash
atc team serve
atc team invite --developer Lowe
atc team invite --developer David
```

Share each one-use invite privately. After pulling `.atc-team.json`, each developer runs the following once per machine and project:

```bash
atc install --developer David
atc team join INVITE_CODE
atc doctor
atc team radar
```

`install` registers the MCP adapter in detected Codex and Claude Code installations and Cursor's user configuration. Use `--only codex,claude-code,cursor` to select clients or `--dry-run` to inspect the plan. `team radar` prints the shared URL and your private browser login token; paste the token into the Radar login form. For other MCP clients, `atc connect` prints a generic entry. Agent names and optional GitHub accounts are display metadata supplied to `begin_task` or the MCP environment; the server binds the developer identity to the private join credential. Different GitHub accounts do not need to authenticate with GitHub for ATC.

The Git repository distributes the coordinator address and project identity. It cannot silently install software or issue private credentials when David clones it. Each person joins once; all of their worktrees for that repository then use the same credential. See the [team rollout specification](docs/team-rollout-spec.md) for the trust model and acceptance checks.

## Local MVP

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

node packages/cli/cli.mjs install --developer YOUR_NAME
cd /path/to/your/project
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs enable
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs connect
```

The installer registers the MCP server in detected Codex, Claude Code, and Cursor installations. For another MCP client, copy the `agent-air-traffic-control` entry printed by `connect`. The first MCP call starts the local daemon automatically. To run it explicitly:

```bash
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs start
```

For concurrent agents with individual names and GitHub logins, run the CLI's `connect` command separately for each MCP client, passing `--harness`, `--agent-name`, `--developer`, and `--github-account`. The login is a display label, not GitHub authentication. See [project onboarding](docs/onboarding.md).

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

Local mode shares airspace among agents on one machine. Team mode shares one coordinator among developer machines.

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
- **Explicit outage.** An unavailable coordinator reports that no ATC write decision was obtained.
- **Metadata only.** Repository contents and conversations stay out of ATC state.
- **Capability honesty.** MCP cooperation and native enforcement are shown distinctly.

Apache-2.0 licensed. See [LICENSE](LICENSE).
