# Plug-and-play onboarding

ATC is a developer-machine integration, not a repository-management application.

## The experience

```bash
npx agent-atc install
cd repository-that-needs-coordination
atc enable
```

`install` happens once per developer. It detects installed harnesses, registers one shared local MCP server, installs the strongest available lifecycle adapter, and configures automatic daemon startup.

`enable` happens once per repository. It creates `.atc/config.json` locally and adds `.atc/` to `.gitignore`; nothing about ATC setup needs to be committed. ATC identifies the repository from its normalized Git remote, then discovers active branches and worktrees automatically.

## Universal behavior

Every adapter implements the same contract:

1. announce session and capabilities;
2. register agent-generated intent;
3. publish observed file activity;
4. ask ATC before a write or scope expansion;
5. obey `allow`, `warn`, or `deny`;
6. renew leases and close the task automatically.

The dashboard only observes this activity. Humans do not claim paths, update statuses, resolve collisions, or assign work there.

## Honest capability levels

Native pre-write hooks can enforce an ATC `deny`. MCP-only harnesses receive the same context and must cooperate. Filesystem observation catches work for unknown or partially integrated agents shortly after it happens. ATC must show the actual protection level, never claim universal prevention.

