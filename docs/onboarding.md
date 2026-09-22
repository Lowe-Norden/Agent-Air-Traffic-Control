# Connect a project

ATC is a local developer-machine integration. A project is connected once; every compatible coding agent then uses the same MCP contract and sees the same live airspace.

## 1. Prepare ATC

From the ATC checkout:

```bash
pnpm install
node packages/cli/cli.mjs install
```

The install command detects known agent CLIs and explains their honest protection level. It does not upload or register the repository anywhere.

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

ATC starts automatically on the first tool call. You can also run the service explicitly with `atc start`. The dashboard is at `http://127.0.0.1:3000` and binds only to loopback by default.

## 4. Agent operating loop

Agent instructions should require:

1. call `begin_task` before editing;
2. call `check_write` immediately before each edit;
3. obey a denial and use `message_agent` to coordinate;
4. call `heartbeat` during work lasting more than one minute; and
5. call `complete_task` when finished.

`begin_task` returns all active work and relevant messages, so each new agent starts with shared awareness. `message_agent` can address a session ID or `broadcast`.

## Diagnostics

```bash
node /path/to/Agent-Air-Traffic-Control/packages/cli/cli.mjs doctor
```

Doctor reports whether the current project is connected, whether its daemon is live, which agent CLIs are detected, and the protection each adapter can actually provide.

## Security and privacy

The daemon binds to `127.0.0.1`. Its persisted state contains repository identity, agent/user labels, branch/worktree names, declared scopes, file paths, task summaries, coordination messages, timestamps, and decisions. It does not accept or persist file content, prompts, transcripts, environment variables, secrets, or command output.
