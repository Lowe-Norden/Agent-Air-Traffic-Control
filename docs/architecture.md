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

Allowed state includes repository identity, agent/user labels, task summaries, relative file scopes and paths, branch/worktree names, capabilities, coordination messages, timestamps, and decisions. Source code, prompts, transcripts, secrets, environment variables, and command output are outside the protocol.

## Next architecture step

The team coordinator milestone will add authenticated multi-machine synchronization, SQLite retention, ordered WebSocket resume, and offline reconciliation. The local daemon and MCP contract remain the edge interface.
