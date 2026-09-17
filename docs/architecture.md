# Architecture

## Components

```text
Coding agent
  | native adapter + MCP
  v
Local daemon ---- local cache / offline queue
  | metadata events over WebSocket
  v
Coordinator ---- append-only repository event log
  |
  +---- other daemons
  +---- live web UI
```

### Protocol

The protocol package owns wire schemas, identifiers, event envelopes, snapshots, leases, capabilities, and collision results. All processes consume the same versioned schemas.

### Local daemon

The daemon observes agent lifecycle, filesystem changes, Git state, and dependency relationships. It hosts the local MCP surface, maintains cached airspace state, evaluates low-latency local checks, and queues outbound events offline.

### Coordinator

The coordinator authenticates connections, orders repository events, maintains leases, evaluates cross-session collisions, persists the event log, and broadcasts updates. One process and SQLite are sufficient for v0.

### Adapters

Adapters translate each coding agent's actual capabilities into a common contract. They negotiate capabilities explicitly; ATC must not claim preventative coverage when only post-write observation is available.

### Web UI

The UI loads a consistent snapshot and then subscribes after the snapshot sequence. It derives views from the event stream and never polls for live state.

## Trust boundary

Repository content remains on the developer machine. The coordinator receives an allowlisted event model. Unknown fields are rejected at serialization boundaries, and telemetry is opt-in.

## Ordering and reconnection

The coordinator assigns a monotonically increasing sequence per repository. Clients persist the last applied sequence. On reconnect, a client requests events after that value; if retention cannot satisfy the request, it reloads a snapshot.

## Repository identity

Repository identity is derived from a normalized Git remote fingerprint. Branch and worktree are session attributes, not repository identity.

## Lease lifecycle

Claims have a short TTL renewed by session heartbeats. A missing heartbeat transitions the session through stale to closed and releases its claims. Clients treat server time as authoritative for lease expiry.

## Collision evaluation

Collision detection begins as deterministic, explainable rules. Inputs are active tasks, claims, observed activity, dependency edges, recency, and attribution confidence. Results always contain reasons and support overrides.

