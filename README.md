# Agent Air Traffic Control

Real-time coordination infrastructure for teams running multiple coding agents against the same codebase.

> Git tells agents what happened. Agent Air Traffic Control tells them what is happening.

Agent Air Traffic Control (ATC) is an early-stage open-source project. It gives coding agents shared awareness of active work, temporary scope claims, and emerging collisions—without uploading source code or becoming a task manager.

## What we are building first

The first usable release proves one narrow workflow:

1. Two developers run Codex or Claude Code against the same repository.
2. Each agent registers its task and expected scope automatically.
3. Local daemons observe actual file activity and exchange metadata.
4. ATC detects overlapping work deterministically.
5. The affected agent receives an actionable warning before, or immediately after, a risky write.

The v0 milestone includes:

- a shared, versioned TypeScript protocol;
- short-lived session and scope leases;
- same-file, path-overlap, and same-symbol collision detection;
- a local daemon with filesystem and Git observation;
- a single-process WebSocket coordinator;
- Codex and Claude Code adapters;
- a live repository airspace UI;
- offline, fail-open behavior; and
- metadata-only synchronization by default.

See [docs/product-spec.md](docs/product-spec.md), [docs/architecture.md](docs/architecture.md), and [docs/roadmap.md](docs/roadmap.md).

## Repository status

This initial commit establishes the product contract and the first executable core: protocol schemas plus a deterministic collision scorer. The coordinator, daemon, adapters, and UI are scaffolded as explicit milestones rather than implied to be complete.

## Development

Prerequisites: Node.js 22+ and pnpm 10+.

```bash
pnpm install
pnpm check
pnpm test
```

## Design principles

- **No human status reporting.** Agents and local observation maintain state.
- **Precision over recall.** Interrupt only for actionable collisions.
- **Leases, not locks.** Claims expire when heartbeats stop.
- **Fail open.** ATC must never block development because its coordinator is unavailable.
- **Metadata only.** Source, prompts, transcripts, secrets, and command output stay local.
- **Capability honesty.** Integrations report the protection they can actually provide.

## Contributing

The project is in specification and foundation stage. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change.

## License

Apache License 2.0. See [LICENSE](LICENSE).

