import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const mcpPath = fileURLToPath(new URL("../mcp-server/server.mjs", import.meta.url));
const name = "agent-air-traffic-control";
const has = (command) => {
  try { execFileSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" }); return true; } catch { return false; }
};
const run = (command, args) => execFileSync(command, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const registered = (command) => { try { run(command, ["mcp", "get", name]); return true; } catch { return false; } };

export function installPlan({ developer, only, detect = has, home = homedir() } = {}) {
  developer = String(developer || "").trim();
  if (!developer) throw new Error("Usage: atc install --developer NAME [--only codex,claude-code,cursor] [--dry-run]");
  const requested = only ? new Set(only.split(",").map((item) => item.trim())) : null;
  const supported = ["codex", "claude-code", "cursor"];
  if (requested && [...requested].some((item) => !supported.includes(item))) throw new Error("Unknown harness in --only; choose codex, claude-code, or cursor.");
  return supported.filter((item) => !requested || requested.has(item)).map((harness) => ({ harness, detected: harness === "cursor" ? detect("cursor") || existsSync(join(home, ".cursor")) || !!requested?.has("cursor") : detect(harness === "claude-code" ? "claude" : harness), developer, command: process.execPath, args: [mcpPath] }));
}

export function installHarnesses({ developer, only, dryRun = false, detect = has, runCommand = run, home = homedir(), isRegistered = registered } = {}) {
  const plan = installPlan({ developer, only, detect, home });
  if (dryRun) return plan;
  for (const item of plan.filter((entry) => entry.detected)) {
    if (item.harness === "codex") {
      if (isRegistered("codex")) runCommand("codex", ["mcp", "remove", name]);
      runCommand("codex", ["mcp", "add", name, "--env", "ATC_HARNESS=codex", "--env", `ATC_DEVELOPER_NAME=${item.developer}`, "--", item.command, ...item.args]);
    } else if (item.harness === "claude-code") {
      if (isRegistered("claude")) runCommand("claude", ["mcp", "remove", "--scope", "user", name]);
      runCommand("claude", ["mcp", "add", "--scope", "user", "--transport", "stdio", "--env", "ATC_HARNESS=claude-code", "--env", `ATC_DEVELOPER_NAME=${item.developer}`, name, "--", item.command, ...item.args]);
    } else {
      const path = join(home, ".cursor", "mcp.json");
      const config = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
      config.mcpServers ||= {};
      config.mcpServers[name] = { command: item.command, args: item.args, env: { ATC_HARNESS: "cursor", ATC_DEVELOPER_NAME: item.developer } };
      mkdirSync(join(home, ".cursor"), { recursive: true });
      writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    }
  }
  return plan;
}
