# Git-native remote Radar specification

## Decision and scope

This is the implemented second team transport. ATC uses only authenticated Git `fetch`, `ls-remote`, and `push` during normal operation. It does not use GitHub Issues, Discussions, APIs, Actions, Pages, Codespaces, Packages, webhooks, or a hosted ATC process. Existing development CI is separate from the ATC runtime.

Every active developer machine runs its own MCP adapter, local ATC process, and Radar at `localhost`. They exchange metadata through a dedicated Git ref. With GitHub reachable, all Radars converge on the same ordered team state. No machine has to stay on when nobody is working. GitHub is the durable rendezvous point; this design therefore still creates Git network traffic and commits.

This is a near-live product: task starts, completions, claims, and messages appear after a successful push and the next remote refresh, normally within about 30 seconds. It is not instant push delivery. A disconnected machine cannot know new remote work, and ATC must show the age of its last successful sync.

## User experience

1. An owner installs ATC and runs `atc team init --transport git` in the target repository. ATC creates `refs/notes/atc-radar` with an initial state commit and writes a tracked `.atc-team.json` containing protocol version, canonical repository identity, Git transport, and the ref name. It never writes credentials or agent state to the source branch.
2. Lowe and David clone the repository normally, install the MCP adapter once, and run `atc team connect --developer NAME`. Connect verifies fetch and push access to the Radar ref using their existing Git credential setup. No invitation server or ATC bearer token is involved.
3. Each agent calls the same six MCP tools. The local ATC process groups all agents on that machine and serializes its own writes. Each local Radar shows local agents immediately and remote agents after sync, with an explicit `last synced` time and freshness indicator.
4. The developer opens their own `http://127.0.0.1:3000` Radar. Both Radars show the same committed team sessions, claims, messages, and collision decisions after convergence. The URL is local to each developer; there is no shared hosted website.

Codex, Claude Code, Cursor, and other MCP clients use the same adapter. Agent names and reported GitHub accounts remain separate display fields. Git authenticates the local machine's push using its configured credential; a Git commit author or ATC label alone does not prove which GitHub account pushed it. Verified per-agent GitHub identity would require an additional signing or credential design and is outside v1.

## Git layout and state

- Default ref: `refs/notes/atc-radar`. This is outside `refs/heads`, so it is not a branch and is not included in normal pull requests or merges. ATC performs Git operations from an isolated cache under its local data directory; it never switches the developer's checkout or modifies its index.
- One commit contains one bounded `state.json` snapshot: schema version, repository ID, monotonic sequence, timestamp, active sessions, declared scopes, lease deadlines, outstanding messages, collision advisories, and a capped recent event list. Git commit ancestry provides the audit trail. Source files, prompts, transcripts, command output, tokens, and environment variables are prohibited.
- Session IDs identify processes. Each session also carries developer display name, harness, agent name, optional GitHub-account label, task summary, branch, worktree label, scopes, and last reported activity. The client never trusts a session ID alone as authorization; repo write access is the trust boundary for this transport.
- State parsing is versioned and size bounded. An invalid, rewritten, or wrong-repository ref is displayed as unverified and cannot produce an ATC allow decision.
- Repository collaborators with push access can read and alter this metadata. The ref is not a confidential or tamper-proof store. Use a private repository when task names or paths are sensitive. Metadata remains in Git history until retention and Git garbage collection remove it; deleting it from the latest snapshot does not erase history.

## Mutation protocol

For `begin_task`, message, completion, and a claim update:

1. Fetch exactly the configured Radar ref and validate the parent snapshot, schema, repository ID, and sequence.
2. Apply the operation locally. For `begin_task`, reject overlap with a live claim before committing. Do not acknowledge success before the remote accepts the write.
3. Create a new commit whose parent is the fetched tip and push it **without force**. If another developer pushed first, the non-fast-forward update is rejected; fetch again, re-evaluate the conflict, and retry with bounded jitter. A claim that has become conflicting is denied instead of retried as an unconditional append.
4. If a push returns an error, fetch the ref and check whether the attempted commit is now the tip or its ancestor. Report an accepted commit as success, an unchanged remote as error, and never turn an uncertain claim or check into an `allow` decision.

This gives one serialized order for accepted claims among cooperating clients. It does not prevent an external Git client with write permission from force-pushing or corrupting the ref. A native harness hook is still needed to physically stop an agent that ignores MCP denials.

`check_write` first refreshes the remote ref (with a short in-process cache only for repeated checks within a single tool operation), then evaluates the latest claim state. It cannot guarantee that a second agent will not claim a scope immediately after the check; the scope should be claimed at `begin_task`, and writes outside the claimed scope must be denied or require an atomic claim expansion. The UI reports decisions as cooperative unless a native hook is installed.

## Refresh, liveness, and traffic budget

- One sync loop per local ATC process, not one per agent or browser tab. Check the Radar ref every 30 seconds while that process runs; fetch only when the tip changes. A write check forces a fresh remote check. Closing the process stops polling.
- Publish task starts, scope changes, completions, and messages promptly. Debounce low-value status changes. Batch all local agents into **one presence update per machine every five minutes**; mark a remote machine's sessions stale after twelve minutes without an accepted update. Stale is a liveness label, not proof that the process stopped.
- At a continuously visible Radar, 30-second polling means about 120 Git checks per hour per developer, or 960 during an eight-hour day. Two developers generate about 1,920 checks in that scenario. Two active machines generate about 192 five-minute presence pushes over eight hours, plus task and message changes. These are design estimates, not a GitHub service guarantee.
- Coalesce writes and back off on rejections or throttling. GitHub recommends staying at or below six pushes per minute per repository; the initial supported target is two to five developers and modest task churn. Do not implement per-agent 30-second Git heartbeats. Monitor actual pushes, bytes, latency, ref size, and sync failures during the pilot.
- The latest snapshot caps completed sessions, tasks, messages, collisions, and events, but the notes ref's commit history still grows. This version never silently rewrites history; retention and Git garbage collection need a measured plan before high-volume rollout.

## Repository integration and onboarding checks

- Before enabling the transport in a target repository, inspect its workflow triggers and verify a notes-ref probe push starts zero workflows. A temporary notes-ref probe in the ATC repository started zero Actions runs; the Norden repository has not been checked. `[skip ci]` is also present on Radar commits.
- Check that normal collaborators can push the notes ref. Never request an exemption for `main` or force-push it. Repository rulesets can target nonbranch refs, so confirm actual access in the target repository.
- Reuse each developer's existing Git authentication and credential helper. Never embed a token in `.atc-team.json`, an MCP configuration, a Git URL, or a commit. `atc doctor` must test both read and write capability without altering source branches.
- A developer without Git write access may view the Radar but cannot publish agent state. ATC must show this explicitly rather than report a connected agent.

## Failure and acceptance gates

- Two independent clones, separate Git credentials, and distinct Codex/Claude MCP processes converge on the same active sessions and messages. Each local Radar shows the other developer's task within one refresh interval after the push is accepted.
- Two simultaneous overlapping `begin_task` operations produce exactly one accepted claim; the losing client refetches and receives the real owner/context. Different scopes can both succeed after retry.
- Concurrent overlapping claims are tested. An unavailable remote yields an error instead of an allow decision. Force-pushed history is detected by an already-running client; other failure cases still need field validation.
- No GitHub API, Issues, Actions, Pages, or third-party runtime is used by ATC. Verify that Radar writes trigger **zero** workflows in the actual target repository and that only metadata reaches Git.
- Pilot with Lowe and David for at least one working day. Record median and worst-case remote visibility delay, push count, fetch count, state size, GitHub throttling, and false conflicts before replacing the current self-hosted transport.

## Current status

Git-native transport is implemented and locally tested with two clones and independent MCP processes. The existing coordinator transport remains available. The target Norden repository's URL, ref permissions, and workflow behavior have not been verified; activation there is a separate step.

## Source constraints

- [Git fetch and refspec behavior](https://git-scm.com/docs/git-fetch)
- [Git push non-fast-forward behavior](https://git-scm.com/docs/git-push)
- [GitHub repository push-rate guidance](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)
- [GitHub push workflow triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
