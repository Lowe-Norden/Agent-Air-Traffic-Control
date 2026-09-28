#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const harnesses = [
  { id: "codex", label: "Codex", command: "codex", protection: "MCP + optional native hook" },
  { id: "claude-code", label: "Claude Code", command: "claude", protection: "MCP + optional native hook" },
  { id: "cursor", label: "Cursor", command: "cursor", protection: "MCP" },
  { id: "custom", label: "Any MCP agent", command: null, protection: "MCP" },
];

const hasCommand = (command) => {
  if (!command) return false;
  try { execFileSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" }); return true; } catch { return false; }
};
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
function gitRoot(cwd = process.cwd()) { try { return git(["rev-parse", "--show-toplevel"], cwd); } catch { throw new Error("Run this command from inside a Git repository."); } }
const detected = () => harnesses.map((item) => ({ ...item, detected: hasCommand(item.command) }));
const idFor = (fingerprint) => `repo_${createHash("sha256").update(fingerprint.toLowerCase()).digest("hex").slice(0, 16)}`;
const mcpPath = fileURLToPath(new URL("../mcp-server/server.mjs", import.meta.url));

function enable() {
  const root = gitRoot();
  const atcDir = join(root, ".atc"), configPath = join(atcDir, "config.json");
  mkdirSync(atcDir, { recursive: true });
  const fingerprint = (() => { try { return git(["config", "--get", "remote.origin.url"], root) || `local:${root}`; } catch { return `local:${root}`; } })();
  const config = { version: 1, enabled: true, repository: { id: idFor(fingerprint), name: basename(root), fingerprint, root: "." }, daemon: { host: "127.0.0.1", port: 3000 }, policy: { default: "warn", exactFileConflict: "deny", leaseSeconds: 90 }, adapters: detected().map(({ id, detected: active, protection }) => ({ id, active, protection })) };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(atcDir, "mcp.json"), `${JSON.stringify({ mcpServers: { "agent-air-traffic-control": { command: process.execPath, args: [mcpPath], env: { ATC_PORT: "3000" } } } }, null, 2)}\n`);
  const ignorePath = join(root, ".gitignore"), ignore = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  if (!ignore.split(/\r?\n/).includes(".atc/")) writeFileSync(ignorePath, `${ignore.replace(/\s*$/, "")}\n.atc/\n`);
  console.log(`ATC connected: ${config.repository.name}\nRepository: ${config.repository.id}\nLocal config: ${configPath}\nMCP config: ${join(atcDir, "mcp.json")}\n\nNext: copy the MCP entry into your agent, or run \`atc connect\` to print it.`);
}

function readConfig() {
  const root = gitRoot(), path = join(root, ".atc", "config.json");
  if (!existsSync(path)) throw new Error("This repository is not connected. Run `atc enable` first.");
  return { root, config: JSON.parse(readFileSync(path, "utf8")) };
}

function connect() {
  const { root } = readConfig(), path = join(root, ".atc", "mcp.json");
  if (!existsSync(path)) throw new Error("MCP config is missing. Run `atc enable` again.");
  console.log(readFileSync(path, "utf8").trim());
  console.error("\nAdd this server to any MCP-capable coding agent. The server starts ATC automatically and identifies this repository from the agent's working directory.");
}

async function doctor() {
  console.log("ATC diagnostics\n");
  let connected = false, config;
  try { ({ config } = readConfig()); connected = true; } catch {}
  console.log(`Connected project     ${connected ? `✓ ${config.repository.name} (${config.repository.id})` : "✗ run atc enable"}`);
  try { const response = await fetch(`http://127.0.0.1:${config?.daemon?.port || 3000}/api/health`); console.log(`Local daemon         ${response.ok ? "✓ online" : "✗ unhealthy"}`); } catch { console.log("Local daemon         – starts automatically with the MCP server"); }
  for (const item of detected()) console.log(`${item.label.padEnd(21)}${item.detected ? "✓ detected" : "– not detected"}  ${item.protection}`);
}

function install() {
  console.log("Agent Air Traffic Control is ready on this machine.\n");
  for (const item of detected()) console.log(`${item.detected ? "✓" : "–"} ${item.label}: ${item.protection}`);
  console.log("\nIn each project, run: atc enable\nThen add the generated .atc/mcp.json entry to your coding agent. No source code or prompts leave the machine.");
}

async function start() {
  const { root, config } = readConfig();
  const { listen } = await import("../daemon/server.mjs");
  await listen({ root, host: config.daemon?.host, port: config.daemon?.port });
}

const command = process.argv[2] || "doctor";
try {
  if (command === "install") install();
  else if (command === "enable") enable();
  else if (command === "connect") connect();
  else if (command === "doctor") await doctor();
  else if (command === "start") await start();
  else { console.error("Usage: atc <install|enable|connect|doctor|start>"); process.exitCode = 1; }
} catch (error) { console.error(`ATC: ${error.message}`); process.exitCode = 1; }
