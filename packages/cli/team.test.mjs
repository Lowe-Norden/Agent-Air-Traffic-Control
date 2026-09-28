import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createTeamServer } from "../team-server/server.mjs";
import { initTeam, inviteTeam, joinTeam } from "./team.mjs";

test("two cloned repositories join once and coordinate through MCP", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "atc-team-cli-"));
  const root = join(parent, "owner"), peer = join(parent, "peer");
  for (const path of [root, peer]) {
    execFileSync("git", ["init", path], { stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", path === root ? "https://github.com/example/norden-ai-platform.git" : "git@github.com:example/norden-ai-platform.git"], { cwd: path });
  }
  initTeam(root, "http://127.0.0.1:3200");
  const server = await createTeamServer({ root });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}`;
  const manifest = JSON.parse(await readFile(join(root, ".atc-team.json"), "utf8"));
  manifest.coordinator.url = url;
  await writeFile(join(root, ".atc-team.json"), JSON.stringify(manifest));
  await writeFile(join(peer, ".atc-team.json"), JSON.stringify(manifest));
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    }
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await server.store.writeQueue;
    await server.auth.writeQueue;
    await rm(parent, { recursive: true, force: true });
  });
  const loweInvite = await inviteTeam(root, "Lowe");
  const davidInvite = await inviteTeam(root, "David");
  const loweHome = join(parent, "lowe-home"), davidHome = join(parent, "david-home");
  process.env.ATC_HOME = loweHome;
  await joinTeam(root, loweInvite.code);
  process.env.ATC_HOME = davidHome;
  await joinTeam(peer, davidInvite.code);
  delete process.env.ATC_HOME;
  const launch = (cwd, home, harness, agentName) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../mcp-server/server.mjs", import.meta.url))], { cwd, env: { ...process.env, ATC_HOME: home, ATC_HARNESS: harness, ATC_AGENT_NAME: agentName }, stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    return { child, lines: createInterface({ input: child.stdout }) };
  };
  const call = async (client, id, name, args) => {
    client.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`);
    const [line] = await once(client.lines, "line");
    const result = JSON.parse(line).result;
    assert.equal(result.isError, false, result.content?.[0]?.text);
    return result.structuredContent;
  };
  const lowe = launch(root, loweHome, "codex", "Atlas"), david = launch(peer, davidHome, "claude-code", "Scout");
  const first = await call(lowe, 1, "begin_task", { summary: "Build API", scopes: ["src/api/**"] });
  const second = await call(david, 1, "begin_task", { summary: "Build UI", scopes: ["src/ui/**"] });
  assert.equal(first.session.user, "Lowe");
  assert.equal(second.session.user, "David");
  const denied = await call(david, 2, "check_write", { path: "src/api/router.ts" });
  assert.equal(denied.decision, "deny");
  assert.match(denied.agentContext, /Lowe \/ Atlas/);
  await call(david, 3, "message_agent", { to: first.session.id, text: "Can we coordinate?" });
  const airspace = await call(lowe, 2, "get_airspace", {});
  assert.equal(airspace.activeWork.length, 2);
  assert.equal(airspace.messages.at(-1).text, "Can we coordinate?");
  await call(lowe, 3, "complete_task", {});
  await call(david, 4, "complete_task", {});
});
