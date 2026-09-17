import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const sessions = [
  { id: "codex-low", agent: "Codex", user: "Lowe", task: "Refactor ranking engine", scopes: ["src/recommendations/**"], mode: "Hook + MCP", status: "active", color: "#8b5cf6" },
  { id: "claude-david", agent: "Claude Code", user: "David", task: "Update product representation", scopes: ["src/products/**"], mode: "MCP + watcher", status: "active", color: "#f97316" },
  { id: "cursor-samir", agent: "Cursor", user: "Samir", task: "Recommendation settings UI", scopes: ["apps/portal/**"], mode: "MCP + watcher", status: "idle", color: "#06b6d4" },
  { id: "deepseek-lee", agent: "DeepSeek", user: "Lee", task: "Catalog test coverage", scopes: ["tests/catalog/**"], mode: "MCP + watcher", status: "active", color: "#22c55e" },
];
const events = [
  { time: "now", text: "ATC online — metadata-only local airspace" },
  { time: "now", text: "Lowe / Codex registered src/recommendations/**" },
  { time: "now", text: "David / Claude Code registered src/products/**" },
];
let collision = null;
const snapshot = () => ({ sessions, events, collision, policy: { default: "warn", source: "MCP + filesystem observer", rawSourceLeavesMachine: true } });

function send(res, code, type, body) { res.writeHead(code, { "content-type": type }); res.end(body); }
function addEvent(text) { events.unshift({ time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), text }); }
async function body(req) { let value = ""; for await (const chunk of req) value += chunk; return JSON.parse(value || "{}"); }
function pathMatches(scope, path) { const root = scope.replace(/\*\*$/, "").replace(/\/$/, ""); return path === root || path.startsWith(`${root}/`); }

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", html);
  if (req.method === "GET" && url.pathname === "/api/snapshot") return send(res, 200, "application/json", JSON.stringify(snapshot()));
  if (req.method === "POST" && url.pathname === "/api/agent/event") {
    const event = await body(req);
    addEvent(`${event.agent ?? "Unknown agent"}: ${event.summary ?? event.type ?? "activity observed"}`);
    return send(res, 202, "application/json", JSON.stringify(snapshot()));
  }
  if (req.method === "POST" && url.pathname === "/api/agent/check-write") {
    const request = await body(req);
    const owner = sessions.find((session) => session.id === request.sessionId);
    const conflicting = sessions.find((session) => session.id !== request.sessionId && session.status === "active" && session.scopes.some((scope) => pathMatches(scope, request.path)));
    if (!conflicting) return send(res, 200, "application/json", JSON.stringify({ decision: "allow", reason: "No active scope conflict" }));
    collision = { risk: "critical", path: request.path, agents: [`${owner?.user ?? "Unknown"} / ${owner?.agent ?? "Agent"}`, `${conflicting.user} / ${conflicting.agent}`], guidance: `${conflicting.user} is actively working on “${conflicting.task}”. Do not edit this path; coordinate or choose a different scope.` };
    addEvent(`ATC denied ${owner?.agent ?? "agent"} write to ${request.path}; active owner: ${conflicting.user} / ${conflicting.agent}`);
    return send(res, 409, "application/json", JSON.stringify({ decision: "deny", collision, agentContext: `ATC DENY: ${collision.guidance}` }));
  }
  return send(res, 404, "text/plain", "Not found");
}).listen(process.env.PORT ?? 3000, () => console.log(`ATC prototype: http://localhost:${process.env.PORT ?? 3000}`));
