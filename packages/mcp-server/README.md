# MCP server

The stdio MCP server gives every compatible coding agent the same coordination tools:

- `begin_task`
- `get_airspace`
- `check_write`
- `heartbeat`
- `message_agent`
- `complete_task`

It discovers the Git root from the agent process working directory, loads the ignored `.atc/config.json`, verifies that the loopback daemon belongs to that repository, and starts the daemon when needed. It emits only JSON-RPC on stdout.
