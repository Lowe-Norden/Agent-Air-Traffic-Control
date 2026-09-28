# Agent Air Traffic Control

Real-time coordination for teams running multiple coding agents against the same codebase.

> Git tells agents what happened. Agent Air Traffic Control tells them what is happening.

ATC connects a Git project to a local coordination service. Agents use a universal MCP server to announce work, inspect other active tasks, check a path before editing, exchange coordination messages, and release their scope. Humans get a read-only radar and audit log.

## Git-only team Radar

This mode needs no always-on ATC host. Each developer runs ATC and opens their own Radar at `http://127.0.0.1:3000`. ATC exchanges metadata through GitHub using normal Git fetch and push. It creates `refs/notes/atc-radar`, which is **not a branch** and cannot be merged as a normal pull request. It never commits Radar data to `main` or a feature branch.

Install Node.js 22+ and ATC once on each machine:

```bash
npm install -g git+https://github.com/Lowe-Norden/Agent-Air-Traffic-Control.git
atc install --developer Lowe
```

The owner runs this inside the target repository and commits the small manifest:

```bash
atc team init --transport git
git add .atc-team.json
git commit -m "Configure ATC Git Radar"
git push
atc team connect --developer Lowe
atc doctor
atc team radar
```

After pulling that commit, David runs `atc install --developer David`, `atc team connect --developer David`, `atc doctor`, and `atc team radar`. `team connect` proves Git read and push access with David's existing Git credentials. The MCP server also starts the local Radar process automatically on first use. Use `atc connect --harness claude-code --agent-name Scout --github-account david-login` to print an agent-specific MCP entry. Harness, agent name, developer name, and GitHub account are display fields; the Git credential determines actual push access. The same ATC installation can serve Codex, Claude Code, Cursor, and other MCP clients.

The Radar checks for remote changes about every 30 seconds. Task starts, messages, and completions push immediately; active-agent presence is batched about every five minutes, with a twelve-minute lease. A disconnected machine cannot verify fresh remote work; write checks fail when Git is unavailable. MCP denials require agent cooperation unless a native pre-write hook is installed.

Agents do not run Git commands for Radar traffic. The MCP instructions direct them to call `begin_task` to publish a claim, `get_airspace` to read others' work, `message_agent` to coordinate, and `complete_task` to release a claim. ATC alone fetches and pushes `refs/notes/atc-radar` in an isolated local cache. Agents continue to use ordinary feature branches and pull requests for code changes; they never open a PR for the Radar ref. MCP instructions guide participating agents but cannot stop an agent or human from running unrelated Git commands.

Normal Git traffic is not a GitHub Actions minute charge. Radar commits can add Git history and may hit GitHub rate or repository-size guidance. A temporary notes-ref push in the ATC repository triggered zero Actions runs; verify workflow behavior and notes-ref permissions in your target repository before team-wide activation. See the [Git-native Radar specification](docs/git-native-radar-spec.md) for limitations and traffic estimates.

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

Local mode shares airspace among agents on one machine. Git team mode shares state through the notes ref; the earlier team mode shares one coordinator among developer machines.

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
