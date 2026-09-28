import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHarnesses } from "./install.mjs";

test("installer registers distinct Codex and Claude MCP clients and preserves Cursor entries", (t) => {
  const home = mkdtempSync(join(tmpdir(), "atc-install-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".cursor"));
  writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { existing: { command: "other" } } }));
  const calls = [];
  const plan = installHarnesses({ developer: "Lowe", detect: () => true, runCommand: (command, args) => calls.push({ command, args }), isRegistered: () => false, home });
  assert.equal(plan.length, 3);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((item) => item.command), ["codex", "claude"]);
  for (const call of calls) {
    assert.ok(call.args.includes("ATC_DEVELOPER_NAME=Lowe"));
    assert.ok(call.args.includes("--"));
  }
  const cursor = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
  assert.equal(cursor.mcpServers.existing.command, "other");
  assert.equal(cursor.mcpServers["agent-air-traffic-control"].env.ATC_HARNESS, "cursor");
  const dryCalls = [];
  installHarnesses({ developer: "David", dryRun: true, detect: () => true, runCommand: (...args) => dryCalls.push(args), home });
  assert.equal(dryCalls.length, 0);
  assert.equal(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers["agent-air-traffic-control"].env.ATC_DEVELOPER_NAME, "Lowe");
});
