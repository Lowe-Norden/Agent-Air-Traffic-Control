#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { credentialPath, manifestName, readManifest } from "../team-server/config.mjs";

const port = Number(process.env.ATC_PORT || 3000);
const baseUrl = process.env.ATC_URL || `http://127.0.0.1:${port}`;
let sessionId = process.env.ATC_SESSION_ID || null;
let heartbeatTimer = null;
let projectRoot = null, rootsSupported = false, nextClientRequestId = 10_000;
const pendingClientRequests = new Map();

function gitRoot(cwd = process.cwd()) {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { throw new Error("ATC MCP must run inside an enabled Git repository."); }
}

async function resolveProjectRoot() {
  if (projectRoot) return projectRoot;
  for (const candidate of [process.env.ATC_PROJECT_ROOT, process.env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean)) {
    try { return projectRoot = gitRoot(candidate); } catch {}
  }
  if (rootsSupported) {
    const id = nextClientRequestId++;
    const roots = await new Promise((resolve) => {
      const timer = setTimeout(() => { pendingClientRequests.delete(id); resolve(null); }, 2000);
      pendingClientRequests.set(id, (result) => { clearTimeout(timer); resolve(result); });
      send({ jsonrpc: "2.0", id, method: "roots/list", params: {} });
    });
    for (const item of roots?.roots || []) {
      try { return projectRoot = gitRoot(fileURLToPath(item.uri)); } catch {}
    }
  }
  throw new Error("ATC could not find a Git project root. Launch the agent in the repository or set ATC_PROJECT_ROOT.");
}

async function project() {
  const root = await resolveProjectRoot();
  try {
    await access(join(root, manifestName));
    const manifest = await readManifest(root);
    const credential = JSON.parse(await readFile(credentialPath(manifest.repository.id), "utf8"));
    if (credential.repositoryId !== manifest.repository.id || credential.coordinator !== manifest.coordinator.url || !credential.token) throw new Error("ATC team credential does not match this repository. Run `atc team join`.");
    return { root, manifest, credential };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (await access(join(root, manifestName)).then(() => true, () => false)) throw new Error("ATC team credential missing. Run `atc team join`.");
  }
  const configPath = join(root, ".atc", "config.json");
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
  const connected = await project();
  if (!connected.manifest) await ensureDaemon();
  const url = connected.manifest?.coordinator.url || baseUrl;
  const headers = { ...(connected.credential ? { authorization: `Bearer ${connected.credential.token}` } : {}), ...(options.body ? { "content-type": "application/json" } : {}) };
  let response;
  try { response = await fetch(`${url}${path}`, { method: options.body ? "POST" : "GET", headers, ...(options.body ? { body: JSON.stringify(options.body) } : {}) }); }
  catch { throw new Error("ATC coordinator unavailable; no write decision was obtained."); }
  const value = await response.json();
  if (!response.ok && response.status !== 409) throw new Error(value.error || `ATC HTTP ${response.status}`);
  return value;
}

const tools = [
  { name: "begin_task", description: "Announce this agent's task and intended file scopes, then receive the current shared airspace. Call this before editing. Agent identity can come from arguments or this MCP server's ATC_* environment variables.", inputSchema: { type: "object", required: ["summary", "scopes"], properties: { agent: { type: "string", description: "Harness, such as codex, claude-code, cursor, or custom" }, agentName: { type: "string", description: "This agent's display name, independent of its harness" }, user: { type: "string", description: "Developer operating this agent" }, githubAccount: { type: "string", description: "Optional GitHub login used by this agent; descriptive metadata, not authentication" }, summary: { type: "string", maxLength: 240 }, scopes: { type: "array", items: { type: "string" }, description: "Repository-relative paths or globs" }, symbols: { type: "array", items: { type: "string" } } } } },
  { name: "get_airspace", description: "Read active agents, tasks, scopes, collisions, and coordination messages for this project.", inputSchema: { type: "object", properties: {} } },
  { name: "check_write", description: "Ask ATC immediately before editing a repository-relative path. Obey a deny and coordinate with the conflicting agent.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } } },
  { name: "heartbeat", description: "Renew the 90-second session lease and receive fresh shared context.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "idle"] } } } },
  { name: "message_agent", description: "Send a concise coordination message to one active session or broadcast to all agents.", inputSchema: { type: "object", required: ["text"], properties: { to: { type: "string", description: "Session id or broadcast" }, text: { type: "string", maxLength: 1000 } } } },
  { name: "complete_task", description: "Complete this task, release its scopes, resolve its collisions, and close the session.", inputSchema: { type: "object", properties: { summary: { type: "string" } } } },
];

function requireSession() { if (!sessionId) throw new Error("Call begin_task before using this tool."); return sessionId; }
async function callTool(name, args) {
  if (name === "begin_task") {
    const root = (await project()).root;
    const branch = (() => { try { return execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim() || "detached"; } catch { return "unknown"; } })();
    const agent = args.agent || process.env.ATC_HARNESS || "unknown";
    const result = await request("/api/tasks/begin", { body: { ...args, sessionId: sessionId || undefined, agent, agentName: args.agentName || process.env.ATC_AGENT_NAME || agent, user: args.user || process.env.ATC_DEVELOPER_NAME || process.env.USER || process.env.USERNAME || "local developer", githubAccount: args.githubAccount || process.env.ATC_GITHUB_ACCOUNT || null, branch, worktree: root, capabilities: { mcp: true, preWrite: false, postWrite: false } } });
    sessionId = result.session.id;
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(() => {
        if (sessionId) request("/api/sessions/heartbeat", { body: { sessionId, status: "active" } }).catch(() => {});
      }, 30_000);
      heartbeatTimer.unref();
    }
    return result;
  }
  if (name === "get_airspace") return request(`/api/agent/context?sessionId=${encodeURIComponent(sessionId || "")}`);
  if (name === "check_write") return request("/api/agent/check-write", { body: { ...args, sessionId: requireSession() } });
  if (name === "heartbeat") return request("/api/sessions/heartbeat", { body: { ...args, sessionId: requireSession() } });
  if (name === "message_agent") return request("/api/agent/message", { body: { ...args, sessionId: requireSession(), to: args.to || "broadcast" } });
  if (name === "complete_task") { const result = await request("/api/tasks/complete", { body: { ...args, sessionId: requireSession() } }); sessionId = null; if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null; return result; }
  throw new Error(`Unknown tool: ${name}`);
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
async function handle(message) {
  if (message.method === "initialize") { rootsSupported = !!message.params?.capabilities?.roots; return { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "agent-air-traffic-control", version: "0.1.0" }, instructions: "Begin each coding task with begin_task, check_write before editing, coordinate on deny, and call complete_task when done. ATC renews heartbeats while this MCP process is alive." }; }
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
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const index = buffer.indexOf("\n"), line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id === undefined) continue;
    if (!message.method && pendingClientRequests.has(message.id)) { pendingClientRequests.get(message.id)(message.result || null); pendingClientRequests.delete(message.id); continue; }
    handle(message).then(
      (result) => send({ jsonrpc: "2.0", id: message.id, result }),
      (error) => send({ jsonrpc: "2.0", id: message.id, error: { code: error.code || -32603, message: error.message } }),
    );
  }
});
process.stdin.on("end", () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (sessionId) request("/api/tasks/complete", { body: { sessionId, summary: "Agent MCP connection closed" } }).catch(() => {});
});
