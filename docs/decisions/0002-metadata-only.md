# ADR 0002: Metadata-only shared plane

- Status: accepted
- Date: 2026-09-17

## Decision

The coordinator receives only allowlisted operational metadata. Raw source, prompts, transcripts, secrets, environment variables, and command output remain local by default.

## Consequences

Features must be designed around intent, paths, symbols, Git state, dependency edges, presence, and timing. Payload schemas are strict, and adding a shared field requires an explicit privacy review.

