# Local daemon

`server.mjs` is the working local coordinator for one enabled Git repository. It binds to `127.0.0.1`, persists metadata atomically in ignored `.atc/state.json`, expires inactive sessions after 90 seconds, exposes the agent HTTP API, and streams state changes to the read-only dashboard with server-sent events.

Run it through `atc start`; the MCP server also starts it automatically on first use. A port already serving another repository is rejected rather than silently mixing project airspaces.
