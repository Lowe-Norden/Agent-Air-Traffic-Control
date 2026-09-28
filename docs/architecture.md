# Architecture

## Working local MVP

```text
Codex / Claude Code / Cursor / custom MCP agent
                  |
                  | stdio JSON-RPC
                  v
            ATC MCP server
                  |
                  | loopback HTTP
                  v
        Per-project local daemon -------- .atc/state.json
                  |
                  | snapshot + server-sent events
                  v
          Read-only radar dashboard
```

### Project identity

`atc enable` derives a stable ID from the normalized Git remote and writes it to ignored `.atc/config.json`. Branch and worktree are session attributes, not repository identity. Before using an already-running daemon, MCP verifies that the daemon's repository ID matches the current project so two projects cannot silently share an airspace.

### Agent interface

The MCP server is the universal integration surface. Agents announce task intent and scopes, read the airspace, check paths before writes, renew leases, send direct or broadcast messages, and complete work. The same contract works for any MCP client.

MCP is cooperative: an agent receives a strong, model-readable denial, but physical prevention requires a native pre-write hook. Capability metadata keeps this distinction visible.

### Local daemon

The daemon owns the repository's ordered event sequence and materialized state. It uses atomic file replacement for persistence, keeps the most recent 1,000 events, and marks sessions stale after 90 seconds without a heartbeat. The API accepts metadata only and binds to loopback by default.

### Dashboard

The UI loads a consistent snapshot and then listens for server-sent events. It shows active sessions, tasks, branches, scopes, open collision advisories, agent messages, and the event log. It has no controls that let humans claim work or resolve collisions.

### Privacy boundary

Allowed state includes repository identity, agent/developer labels, optional reported GitHub logins, task summaries, relative file scopes and paths, branch/worktree names, capabilities, coordination messages, timestamps, and decisions. Session IDs identify concurrent agents independently of their display names or GitHub logins. Source code, prompts, transcripts, secrets, environment variables, and command output are outside the protocol.

## Shared team coordinator

```text
Codex / Claude Code / Cursor on each developer machine
                     | stdio MCP
                     v
               ATC MCP adapter
                     | authenticated HTTPS
                     v
        One self-hosted coordinator -------- .atc/team-airspace.json
                     | snapshot + server-sent events
                     v
                Read-only Flight Radar
```

The tracked `.atc-team.json` selects the coordinator and canonical Git repository identity. A one-use invitation creates a developer credential outside Git. The server binds every session to that authenticated developer, stores token hashes, and gives browser users a separate read-only session. It persists one ordered materialized state and the most recent 1,000 events with atomic file replacement. A single coordinator process must own the state directory; horizontal scaling and offline reconciliation are not implemented. If the coordinator is unavailable, MCP reports that no decision was obtained.

Native pre-write hooks, credential revocation/rotation, and a managed service installer remain separate improvements. MCP alone relies on the agent to call `check_write` and obey denials.
