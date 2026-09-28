# Team rollout specification

## Promise

One self-hosted ATC coordinator owns one repository's airspace and Flight Radar. Each developer installs the local MCP adapter once and joins the project once. Agents started in that repository use the same six-tool contract; their sessions, scopes, messages, and collisions appear in one ordered view. ATC makes no GitHub API or Actions calls during normal operation.

"Same MCP" means the same adapter and tool protocol, with a separate stdio process per agent. Every process connects to one coordinator. A repo checkout alone cannot safely install software or authenticate a new developer.

## Setup and trust boundaries

1. An owner runs `atc team init --url https://atc.example.internal` in the target Git repository. This writes a tracked `.atc-team.json` containing the protocol version, repository ID, canonical Git remote, and coordinator URL. It creates ignored local coordinator credentials and state. It never commits a token.
2. The owner hosts `atc team serve` on an always-reachable machine. It binds to loopback by default, so a self-hosted HTTPS reverse proxy can expose it to the team. Direct non-loopback service requires TLS. The coordinator serves the API and read-only Flight Radar together.
3. The owner creates an expiring, one-use invite for a named developer. The invite is shared out of band. The developer runs `atc team join <invite>` in any checkout containing `.atc-team.json`. Their token is stored outside Git and applies to worktrees with the same repository ID.
   The owner also creates and redeems an invite for their own development credential; the separate admin token only manages invitations.
4. Each developer runs `atc install --developer NAME` once per machine. The installer registers the local stdio MCP adapter with detected Codex and Claude Code CLIs and Cursor's user MCP file, preserving unrelated configuration. The developer can select a subset or use the generated generic MCP entry for other clients. Harness-specific native hooks are separate capability levels.
5. On first `begin_task` in a team-enabled repository, the adapter reads `.atc-team.json` and its local credential, then contacts the coordinator. No per-worktree `atc enable` is needed. The server binds the session to the authenticated developer; agent names and GitHub logins remain descriptive labels.

## Coordinator contract

- All task, heartbeat, write-check, message, completion, snapshot, and event-stream operations use the existing agent-neutral contract and one shared `AtcState`.
- Bearer tokens authorize API writes and agent reads. The server stores only token hashes. Session IDs are scoped to the authenticated developer. A separate read-only browser login issues a restricted session cookie for the radar.
- Invite codes expire after one day and can be redeemed once. A coordinator restart preserves invites, memberships, and airspace.
- The state contains metadata only: identities, branch/worktree names, task summaries, scopes, paths, messages, decisions, and timestamps. It excludes source, prompts, transcripts, command output, and bearer tokens.
- One coordinator process owns its state files. Browser sessions expire after 12 hours and are renewed by logging in again after a restart. This build does not provide credential revocation or rotation, horizontal scaling, or offline reconciliation.
- The existing 90-second lease closes abandoned claims. The MCP process renews its lease while active and closes it on normal shutdown; crashes expire naturally.
- If the coordinator is unreachable, the adapter reports an explicit unavailable result. It must never claim that a write was allowed by ATC when no check occurred.

## Harness capability levels

Codex, Claude Code, Cursor, and any stdio MCP client share the cooperative tools. Registration is automatic only for verified installers; unknown clients use the generated MCP entry. Native pre-write hooks may add a stronger denial where supported, but no harness is advertised as physically blocked merely because it has MCP. `atc doctor` reports the actual installed connection and capability.

## Acceptance gates

- Two separate clones and developer credentials connect to one self-hosted coordinator. Distinct Codex and Claude Code MCP processes show in one snapshot and radar; a cross-developer path conflict is denied with the real owner and task context.
- A message from either developer is visible to the other on its next context call. A third, unjoined client gets 401; a client cannot act on another developer's session ID.
- A late joiner receives the current snapshot. Coordinator restart preserves state and membership; stale claims expire after 90 seconds.
- No secret is written to the tracked project file or agent configuration. Non-loopback cleartext URLs are rejected. No GitHub call is needed for normal use.
- The repository CI passes; a real self-hosted deployment awaits a hostname, reachable host, and TLS certificate or existing HTTPS reverse proxy.
