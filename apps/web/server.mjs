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

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", html);
  if (req.method === "GET" && url.pathname === "/api/snapshot") return send(res, 200, "application/json", JSON.stringify(snapshot()));
  if (req.method === "POST" && url.pathname === "/api/demo-collision") {
    collision = { risk: "critical", path: "src/products/types.ts", agents: ["Lowe / Codex", "David / Claude Code"], guidance: "David is changing ProductRepresentation. Avoid this interface or coordinate before editing." };
    addEvent("HIGH RISK — Codex and Claude Code overlap in src/products/types.ts");
    addEvent("ATC sent collision context to Lowe / Codex");
    return send(res, 200, "application/json", JSON.stringify(snapshot()));
  }
  if (req.method === "POST" && url.pathname === "/api/resolve") { collision = null; addEvent("Collision resolved — Codex changed scope"); return send(res, 200, "application/json", JSON.stringify(snapshot())); }
  return send(res, 404, "text/plain", "Not found");
}).listen(process.env.PORT ?? 3000, () => console.log(`ATC prototype: http://localhost:${process.env.PORT ?? 3000}`));
