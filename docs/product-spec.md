# Product specification

## Product statement

Agent Air Traffic Control is a real-time coordination layer for coding agents. It shares operational metadata about current work so agents can avoid collisions while changes are happening.

## Primary user

A software team with two or more developers or coding-agent sessions working concurrently in one Git repository, often across branches or worktrees.

## Core job

Before an agent edits code that overlaps another active task, give that agent enough current, trustworthy context to adjust its plan or coordinate.

## v0 user journey

1. A developer runs `npx agent-atc init` once.
2. ATC detects the Git repository and supported coding-agent integrations.
3. Starting a supported agent starts or reuses the local daemon.
4. After understanding the user's request, the agent registers a one-sentence task, expected paths, and important symbols.
5. The daemon observes branch, worktree, and file activity and renews short-lived claims.
6. The coordinator synchronizes metadata between machines.
7. Before a relevant write, the adapter checks cached airspace state.
8. A deterministic collision result is injected into the affected agent.
9. Claims expire automatically when a session ends or heartbeats stop.

## Functional requirements

### Sessions and intent

- Identify repository, user, machine, branch, worktree, agent, and adapter capabilities.
- Register task intent without a second human status workflow.
- Renew presence approximately every five seconds.
- Represent active, idle, stale, and closed session states.

### Scope

- Keep declared, observed, and dependency-derived scope distinct.
- Support directory, file, symbol, package, and dependency claims.
- Treat claims as expiring leases, never permanent locks.
- Preserve attribution confidence rather than implying certainty.

### Collision detection

- Detect exact-file, path-overlap, and exact-symbol collisions in v0.
- Add dependency collisions after path-based detection is reliable.
- Score deterministically and include machine-readable reasons.
- Suppress read/read overlap and other non-actionable noise.
- Support observe, warn, and protect modes; default to warn during early releases.

### Synchronization

- Assign a monotonically increasing event sequence per repository.
- Load a snapshot, then stream events after its sequence.
- Resume from the last applied sequence after reconnecting.
- Queue local events while offline and reconcile on reconnect.

### Agent tools

The minimal coordination surface is:

- `atc_begin_task`
- `atc_status`
- `atc_check_scope`
- `atc_expand_scope`
- `atc_message`
- `atc_complete_task`

### UI

Answer, in order: who is working, what they are doing, where they are working, and whether anything is colliding. The UI is an operational view, not a project-management system.

## Privacy requirements

The shared plane may contain repository-relative paths, branch names, dependency edges, agent-generated summaries, symbols, timestamps, and presence. It must not contain raw source, prompts, transcripts, secrets, environment variables, or command output by default.

## Failure behavior

- Coordinator unavailable: continue locally and queue metadata.
- Adapter lacks pre-write support: observe through filesystem and Git events.
- Ownership is ambiguous: report confidence and avoid a hard block.
- Heartbeat stops: mark stale, then expire leases.
- Dependency analysis fails: fall back to path-based evaluation.

## MVP acceptance criteria

- Two machines appear in one repository airspace.
- Agent intent appears without separate human entry.
- File changes propagate in under one second on a healthy network.
- Same-file concurrent work is detected reliably.
- The second agent receives an actionable warning.
- A crashed session leaves no permanent claim.
- Disconnecting the coordinator never blocks local development.
- Network inspection confirms that raw source is not transmitted.

## Explicit non-goals for v0

Task assignment, generic agent orchestration, enterprise SSO, Slack alerts, semantic LLM classification, historical replay, and languages beyond TypeScript/JavaScript.

