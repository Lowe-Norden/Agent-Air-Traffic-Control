#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const harnesses = [
  { id: "codex", label: "Codex", command: "codex", protection: "Hook + MCP + watcher" },
  { id: "claude-code", label: "Claude Code", command: "claude", protection: "MCP + watcher" },
  { id: "cursor", label: "Cursor", command: "cursor", protection: "MCP + watcher" },
  { id: "deepseek", label: "DeepSeek / custom agent", command: null, protection: "MCP + watcher" },
];

function hasCommand(command) { if (!command) return false; try { execFileSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" }); return true; } catch { return false; } }
function gitRoot(cwd) { try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim(); } catch { throw new Error("ATC must be enabled from inside a Git repository."); } }
function detected() { return harnesses.map((harness) => ({ ...harness, detected: hasCommand(harness.command) })); }
function printDoctor() { console.log("ATC diagnostics\n"); console.log(`Git repository       ${existsSync(join(process.cwd(), ".git")) || (() => { try { gitRoot(process.cwd()); return true; } catch { return false; } })() ? "✓" : "✗"}`); for (const harness of detected()) console.log(`${harness.label.padEnd(20)} ${harness.detected ? "✓ detected" : "– not detected"}  ${harness.protection}`); }
function printInstallPlan() { console.log("ATC one-time install plan\n"); console.log("1. Install the global local daemon (~/.atc)."); console.log("2. Register one shared MCP server with each detected harness."); console.log("3. Install native lifecycle adapters only where supported."); console.log("4. Start the daemon automatically when an ATC-enabled repository opens.\n"); for (const harness of detected()) console.log(`${harness.detected ? "✓" : "–"} ${harness.label}: ${harness.protection}`); console.log("\nNo source code, prompts, transcripts, environment variables, or command output are shared."); }
function enable() { const root = gitRoot(process.cwd()); const atcDir = join(root, ".atc"); const configPath = join(atcDir, "config.json"); mkdirSync(atcDir, { recursive: true }); const config = { version: 1, enabled: true, repository: { root: ".", fingerprint: execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: root, encoding: "utf8" }).trim() || "local-only" }, policy: { default: "warn", exactFileConflict: "deny" }, adapters: detected().map(({ id, detected: active }) => ({ id, active })) }; writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`); const ignorePath = join(root, ".gitignore"); const ignore = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : ""; if (!ignore.split(/\r?\n/).includes(".atc/")) writeFileSync(ignorePath, `${ignore.replace(/\s*$/, "")}\n.atc/\n`); console.log(`ATC enabled for ${root}\nConfig: ${configPath}\nGit: .atc/ is ignored`); }
const command = process.argv[2] ?? "doctor";
if (command === "doctor") printDoctor(); else if (command === "install") printInstallPlan(); else if (command === "enable") enable(); else { console.error("Usage: atc <install|enable|doctor>"); process.exitCode = 1; }
