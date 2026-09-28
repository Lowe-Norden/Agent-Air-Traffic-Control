# Connect a project

ATC has a shared team mode and a local single-machine mode. Start with [team setup](../README.md#team-setup) when multiple developers need one airspace and Flight Radar. This page describes local mode.

## 1. Prepare ATC

From the ATC checkout:

```bash
pnpm install
node packages/cli/cli.mjs install --developer YOUR_NAME
```

The install command registers the MCP adapter in detected Codex and Claude Code CLIs and Cursor's user MCP configuration. It does not upload or register the repository anywhere.

## 2. Enable a Git project

Run the CLI from the project to coordinate:

```bash
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs enable
```

This creates:

- `.atc/config.json` with a stable repository ID derived from the Git remote;
- `.atc/mcp.json` with the exact local MCP process configuration; and
- `.atc/` in `.gitignore`.

The directory is deliberately local and must not be committed.

## 3. Connect coding agents

Print the MCP entry:

```bash
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs connect
```

Add the `agent-air-traffic-control` server from that JSON to each MCP-capable agent. The command is portable across Codex, Claude Code, Cursor, and custom clients that accept the standard `command`, `args`, and `env` server shape.

For concurrent agents, generate a separate entry for each MCP client or agent process. For example:

```bash
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs connect --harness codex --agent-name Atlas --developer Nicolas --github-account atlas-bot
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs connect --harness claude-code --agent-name Scout --developer David --github-account scout-bot
```

Copy the first entry into Atlas's Codex MCP configuration and the second into Scout's Claude Code configuration. The labels are defaults for `begin_task`; agents can supply `agent`, `agentName`, `user`, or `githubAccount` in the tool call to override them. Each MCP process receives a distinct session ID, so agents can share a name or developer without being merged. GitHub login is optional, descriptive metadata only. ATC does not authenticate that login or alter the Git credentials used for commits and pull requests.

ATC starts automatically on the first tool call. You can also run the service explicitly with `node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs start`. The dashboard is at `http://127.0.0.1:3000` and binds only to loopback by default.

## 4. Agent operating loop

Agent instructions should require:

1. call `begin_task` before editing;
2. call `check_write` immediately before each edit;
3. obey a denial and use `message_agent` to coordinate;
4. call `heartbeat` during work lasting more than one minute; and
5. call `complete_task` when finished.

`begin_task` returns all active work and relevant messages, so each new agent starts with shared awareness. `message_agent` can address a session ID or `broadcast`.

The local daemon serves one developer machine. For David's separate machine, use the [shared coordinator](../README.md#team-setup). MCP calls are cooperative: an agent must call the tools to receive guidance. Native pre-write hooks are still planned.

## Diagnostics

```bash
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs doctor
```

Doctor reports whether the current project is connected, whether its daemon is live, which agent CLIs are detected, and the protection each adapter can actually provide.

## Security and privacy

The daemon binds to `127.0.0.1`. Its persisted state contains repository identity, agent/developer labels, optional reported GitHub logins, branch/worktree names, declared scopes, file paths, task summaries, coordination messages, timestamps, and decisions. It does not accept or persist file content, prompts, transcripts, environment variables, secrets, or command output.
