import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));

test("enable connects a Git project and generates a universal MCP entry", (t) => {
  const root = mkdtempSync(join(tmpdir(), "atc-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/fixture.git"], { cwd: root });
  const output = execFileSync(process.execPath, [cli, "enable"], { cwd: root, encoding: "utf8" });
  assert.match(output, /ATC connected/);
  const config = JSON.parse(readFileSync(join(root, ".atc", "config.json"), "utf8"));
  assert.equal(config.repository.fingerprint, "https://github.com/example/fixture.git");
  assert.match(readFileSync(join(root, ".atc", "mcp.json"), "utf8"), /agent-air-traffic-control/);
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /\.atc\//);
});

test("CLI exposes the complete onboarding workflow", () => {
  const source = readFileSync(new URL("./cli.mjs", import.meta.url), "utf8");
  for (const command of ["install", "enable", "connect", "doctor", "start"]) assert.match(source, new RegExp(`command === \\"${command}\\"`));
});
