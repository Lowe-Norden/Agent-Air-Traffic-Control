#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.ATC_PORT || 3000);
const baseUrl = process.env.ATC_URL || `http://127.0.0.1:${port}`;
let sessionId = process.env.ATC_SESSION_ID || null;

function gitRoot(cwd = process.cwd()) {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { throw new Error("ATC MCP must run inside an enabled Git repository."); }
}

async function project() {
  const root = gitRoot(), configPath = join(root, ".atc", "config.json");
  await access(configPath).catch(() => { throw new Error("This project is not connected. Run `atc enable` first."); });
  return { root, config: JSON.parse(await readFile(configPath, "utf8")) };
}

async function health() {
  try { const response = await fetch(`${baseUrl}/api/health`); return response.ok ? response.json() : null; } catch { return null; }
}

async function ensureDaemon() {
  const { root, config } = await project(), current = await health();
  if (current?.repository?.id === config.repository.id) return;
  if (current) throw new Error(`ATC port ${port} is serving ${current.repository?.name || "another project"}. Stop it or choose another ATC_PORT.`);
  const daemonPath = fileURLToPath(new URL("../daemon/server.mjs", import.meta.url));
  const child = spawn(process.execPath, [daemonPath], { cwd: root, env: { ...process.env, ATC_REPO: root, ATC_PORT: String(port) }, detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = await health();
    if (started?.repository?.id === config.repository.id) return;
  }
  throw new Error(`ATC daemon did not start at ${baseUrl}`);
}

async function request(path, options = {}) {
  await ensureDaemon();
  const response = await fetch(`${baseUrl}${path}`, options.body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) } : undefined);
  const value = await response.json();
  if (!response.ok && response.status !== 409) throw new Error(value.error || `ATC HTTP ${response.status}`);
  return value;
}

const tools = [
  { name: "begin_task", description: "Announce this agent's task and intended file scopes, then receive the current shared airspace. Call this before editing.", inputSchema: { type: "object", required: ["agent", "summary", "scopes"], properties: { agent: { type: "string", description: "Agent name, such as codex, claude-code, cursor, deepseek, or custom" }, user: { type: "string" }, summary: { type: "string", maxLength: 240 }, scopes: { type: "array", items: { type: "string" }, description: "Repository-relative paths or globs" }, symbols: { type: "array", items: { type: "string" } } } } },
  { name: "get_airspace", description: "Read active agents, tasks, scopes, collisions, and coordination messages for this project.", inputSchema: { type: "object", properties: {} } },
  { name: "check_write", description: "Ask ATC immediately before editing a repository-relative path. Obey a deny and coordinate with the conflicting agent.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } } },
  { name: "heartbeat", description: "Renew the 90-second session lease and receive fresh shared context.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "idle"] } } } },
  { name: "message_agent", description: "Send a concise coordination message to one active session or broadcast to all agents.", inputSchema: { type: "object", required: ["text"], properties: { to: { type: "string", description: "Session id or broadcast" }, text: { type: "string", maxLength: 1000 } } } },
  { name: "complete_task", description: "Complete this task, release its scopes, resolve its collisions, and close the session.", inputSchema: { type: "object", properties: { summary: { type: "string" } } } },
];

function requireSession() { if (!sessionId) throw new Error("Call begin_task before using this tool."); return sessionId; }
async function callTool(name, args) {
  if (name === "begin_task") {
    const root = gitRoot();
    const branch = (() => { try { return execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim() || "detached"; } catch { return "unknown"; } })();
    const result = await request("/api/tasks/begin", { body: { ...args, sessionId: sessionId || undefined, user: args.user || process.env.USER || process.env.USERNAME || "local developer", branch, worktree: root, capabilities: { mcp: true, preWrite: false, postWrite: false } } });
    sessionId = result.session.id;
    return result;
  }
  if (name === "get_airspace") return request(`/api/agent/context?sessionId=${encodeURIComponent(sessionId || "")}`);
  if (name === "check_write") return request("/api/agent/check-write", { body: { ...args, sessionId: requireSession() } });
  if (name === "heartbeat") return request("/api/sessions/heartbeat", { body: { ...args, sessionId: requireSession() } });
  if (name === "message_agent") return request("/api/agent/message", { body: { ...args, sessionId: requireSession(), to: args.to || "broadcast" } });
  if (name === "complete_task") { const result = await request("/api/tasks/complete", { body: { ...args, sessionId: requireSession() } }); sessionId = null; return result; }
  throw new Error(`Unknown tool: ${name}`);
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
async function handle(message) {
  if (message.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "agent-air-traffic-control", version: "0.1.0" }, instructions: "Begin each coding task with begin_task, check_write before editing, coordinate on deny, heartbeat during long tasks, and call complete_task when done." };
  if (message.method === "ping") return {};
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") {
    try { const value = await callTool(message.params?.name, message.params?.arguments || {}); return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: false }; }
    catch (error) { return { content: [{ type: "text", text: `ATC error: ${error.message}` }], isError: true }; }
  }
  throw Object.assign(new Error(`Method not found: ${message.method}`), { code: -32601 });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const index = buffer.indexOf("\n"), line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id === undefined) continue;
    try { send({ jsonrpc: "2.0", id: message.id, result: await handle(message) }); }
    catch (error) { send({ jsonrpc: "2.0", id: message.id, error: { code: error.code || -32603, message: error.message } }); }
  }
});
