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
  const root = gitRoot(), path = join(root, ".atc", "mcp.json"), team = existsSync(join(root, ".atc-team.json"));
  if (!team && !existsSync(path)) throw new Error("MCP config is missing. Run `atc enable` or `atc team join` first.");
  const options = { "--harness": "ATC_HARNESS", "--agent-name": "ATC_AGENT_NAME", "--developer": "ATC_DEVELOPER_NAME", "--github-account": "ATC_GITHUB_ACCOUNT" };
  const entry = team ? { mcpServers: { "agent-air-traffic-control": { command: process.execPath, args: [mcpPath], env: {} } } } : JSON.parse(readFileSync(path, "utf8"));
  const env = entry.mcpServers["agent-air-traffic-control"].env;
  for (let index = 3; index < process.argv.length; index++) {
    const key = options[process.argv[index]];
    if (!key || !process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw new Error("Usage: atc connect [--harness codex|claude-code] [--agent-name NAME] [--developer NAME] [--github-account LOGIN]");
    env[key] = process.argv[++index];
  }
  console.log(JSON.stringify(entry, null, 2));
  console.error("\nAdd this entry to the chosen MCP agent. Each agent process has its own session ID; the supplied name and GitHub login are display metadata, not GitHub authentication.");
}

async function doctor() {
  console.log("ATC diagnostics\n");
  let root;
  try { root = gitRoot(); } catch {}
  if (root && existsSync(join(root, ".atc-team.json"))) {
    const { readManifest } = await import("../team-server/config.mjs");
    const manifest = await readManifest(root);
    console.log(`Team project          ✓ ${manifest.repository.name} (${manifest.repository.id})`);
    if (manifest.version === 2) {
      console.log(`Git Radar ref         ${manifest.git.ref} (not a branch)`);
      try {
        const { GitRadarStore } = await import("../git-team/store.mjs");
        const store = new GitRadarStore({ root, manifest });
        const state = await store.refresh();
        console.log(`Shared airspace       ✓ sequence ${state.sequence}; synced ${store.syncedAt}`);
      } catch (error) { console.log(`Shared airspace       ✗ ${error.message}`); }
      for (const item of detected()) console.log(`${item.label.padEnd(21)}${item.detected ? "detected; verify MCP registration" : "not detected"}`);
      return;
    }
    console.log(`Shared coordinator    ${manifest.coordinator.url}`);
    try {
      const { teamCredential } = await import("./team.mjs");
      const { credential } = await teamCredential(root);
      const response = await fetch(`${manifest.coordinator.url}/api/snapshot`, { headers: { authorization: `Bearer ${credential.token}` } });
      console.log(`Developer             ${credential.developer}`);
      console.log(`Team airspace         ${response.ok ? "✓ connected" : `✗ HTTP ${response.status}`}`);
    } catch (error) { console.log(`Team airspace         ✗ ${error.message}; run atc team join`); }
    for (const item of detected()) console.log(`${item.label.padEnd(21)}${item.detected ? "detected; verify MCP registration" : "not detected"}`);
    return;
  }
  let connected = false, config;
  try { ({ config } = readConfig()); connected = true; } catch {}
  console.log(`Connected project     ${connected ? `✓ ${config.repository.name} (${config.repository.id})` : "✗ run atc enable"}`);
  try { const response = await fetch(`http://127.0.0.1:${config?.daemon?.port || 3000}/api/health`); console.log(`Local daemon         ${response.ok ? "✓ online" : "✗ unhealthy"}`); } catch { console.log("Local daemon         – starts automatically with the MCP server"); }
  for (const item of detected()) console.log(`${item.label.padEnd(21)}${item.detected ? "✓ detected" : "– not detected"}  ${item.protection}`);
}

async function install() {
  const args = process.argv.slice(3), value = (key) => args[args.indexOf(key) + 1];
  const { installHarnesses } = await import("./install.mjs");
  const dryRun = args.includes("--dry-run"), plan = installHarnesses({ developer: args.includes("--developer") ? value("--developer") : undefined, only: args.includes("--only") ? value("--only") : undefined, dryRun });
  for (const item of plan) console.log(`${item.detected ? dryRun ? "would connect" : "connected" : "not detected"} ${item.harness} for ${item.developer}`);
  if (dryRun) console.log("No harness configuration was changed.");
  else console.log("Agent MCP registration is complete. Join a team project once per developer machine; agents then discover its tracked manifest.");
}

async function start() {
  const { root, config } = readConfig();
  const { listen } = await import("../daemon/server.mjs");
  await listen({ root, host: config.daemon?.host, port: config.daemon?.port });
}

const command = process.argv[2] || "doctor";
try {
  if (command === "install") await install();
  else if (command === "team") { const { runTeam } = await import("./team.mjs"); await runTeam(gitRoot(), process.argv.slice(3)); }
  else if (command === "enable") enable();
  else if (command === "connect") connect();
  else if (command === "doctor") await doctor();
  else if (command === "start") await start();
  else { console.error("Usage: atc <install|team|enable|connect|doctor|start>"); process.exitCode = 1; }
} catch (error) { console.error(`ATC: ${error.message}`); process.exitCode = 1; }
