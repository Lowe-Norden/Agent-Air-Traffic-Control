import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAtcServer } from "../daemon/server.mjs";

test("MCP server publishes the complete coordination tool surface", async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);
  const [chunk] = await once(child.stdout, "data");
  const response = JSON.parse(chunk.toString().trim());
  assert.deepEqual(response.result.tools.map((tool) => tool.name), ["begin_task", "get_airspace", "check_write", "heartbeat", "message_agent", "complete_task"]);
  const identity = response.result.tools[0].inputSchema;
  assert.deepEqual(identity.required, ["summary", "scopes"]);
  for (const field of ["agent", "agentName", "user", "githubAccount"]) assert.equal(identity.properties[field].type, "string");
  assert.match(response.result.tools.find((tool) => tool.name === "message_agent").description, /Radar ref automatically/);
});

test("MCP initialization keeps Radar metadata out of code PRs", async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } })}\n`);
  const [chunk] = await once(child.stdout, "data");
  const instructions = JSON.parse(chunk.toString().trim()).result.instructions;
  assert.match(instructions, /refs\/notes\/atc-radar/);
  assert.match(instructions, /never .*open a pull request for it/);
  assert.match(instructions, /normal feature branches and PR workflow only for source-code changes/);
});

test("separate MCP processes register configured identities in one airspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "atc-mcp-identity-"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  await mkdir(join(root, ".atc"));
  await writeFile(join(root, ".atc", "config.json"), JSON.stringify({ repository: { id: "repo_mcp_identity", name: "identity" } }));
  const server = await createAtcServer({ root });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const begin = async (identity) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], { cwd: root, env: { ...process.env, ATC_URL: url, ...identity }, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "begin_task", arguments: { summary: "Work", scopes: ["src/**"] } } })}\n`);
    const [chunk] = await once(child.stdout, "data");
    const response = JSON.parse(chunk.toString().trim());
    const exited = once(child, "exit");
    child.kill();
    await exited;
    assert.equal(response.result?.isError, false, JSON.stringify(response));
    return response.result.structuredContent.session;
  };
  const first = await begin({ ATC_HARNESS: "codex", ATC_AGENT_NAME: "Builder", ATC_DEVELOPER_NAME: "Nicolas", ATC_GITHUB_ACCOUNT: "atlas-bot" });
  const second = await begin({ ATC_HARNESS: "claude-code", ATC_AGENT_NAME: "Builder", ATC_DEVELOPER_NAME: "David", ATC_GITHUB_ACCOUNT: "scout-bot" });
  assert.notEqual(first.id, second.id);
  assert.deepEqual(server.store.snapshot().sessions.map(({ agent, agentName, user, githubAccount }) => ({ agent, agentName, user, githubAccount })), [
    { agent: "codex", agentName: "Builder", user: "Nicolas", githubAccount: "atlas-bot" },
    { agent: "claude-code", agentName: "Builder", user: "David", githubAccount: "scout-bot" },
  ]);
});
