import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { gitProfilePath, gitRadarRef, repositoryId } from "../team-server/config.mjs";
import { AtcState, overlaps } from "../daemon/state.mjs";
import { GitRadarStore } from "./store.mjs";
import { createGitServer } from "./server.mjs";

const post = async (url, route, value) => {
  const response = await fetch(`${url}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  return { status: response.status, value: await response.json() };
};

test("two Git clones and MCP processes share one remote Radar without a coordinator", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "atc-git-radar-"));
  const bare = join(base, "remote.git"), owner = join(base, "lowe"), peer = join(base, "david");
  execFileSync("git", ["init", "--bare", bare], { stdio: "ignore" });
  const remote = "https://github.com/example/norden-ai-platform.git";
  const manifest = { version: 2, repository: { id: repositoryId(remote), name: "norden-ai-platform", fingerprint: "github.com/example/norden-ai-platform" }, transport: "git", git: { remote: "origin", ref: gitRadarRef } };
  for (const root of [owner, peer]) {
    execFileSync("git", ["init", root], { stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: root });
    await writeFile(join(root, ".atc-team.json"), JSON.stringify(manifest));
  }
  const homeLowe = join(base, "home-lowe"), homeDavid = join(base, "home-david");
  const cacheLowe = join(base, "cache-lowe"), cacheDavid = join(base, "cache-david"), cacheInit = join(base, "cache-init");
  const initial = new GitRadarStore({ root: owner, manifest, remoteUrl: bare, cachePath: cacheInit });
  await initial.initialize();
  const previousHome = process.env.ATC_HOME;
  const servers = [], children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    for (const server of servers) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    if (previousHome === undefined) delete process.env.ATC_HOME; else process.env.ATC_HOME = previousHome;
    await rm(base, { recursive: true, force: true });
  });
  const open = async (root, home, cachePath, developer, machineId) => {
    process.env.ATC_HOME = home;
    const profilePath = gitProfilePath(manifest.repository.id);
    await mkdir(join(home, "profiles"), { recursive: true });
    await writeFile(profilePath, JSON.stringify({ version: 1, repositoryId: manifest.repository.id, developer, machineId }));
    const server = await createGitServer({ root, remoteUrl: bare, cachePath, pollMs: 100 });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  };
  const loweUrl = await open(owner, homeLowe, cacheLowe, "Lowe", "machine_lowe");
  const davidUrl = await open(peer, homeDavid, cacheDavid, "David", "machine_david");
  const launch = (cwd, home, url, harness, agentName) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../mcp-server/server.mjs", import.meta.url))], { cwd, env: { ...process.env, ATC_HOME: home, ATC_URL: url, ATC_HARNESS: harness, ATC_AGENT_NAME: agentName }, stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    return { child, lines: createInterface({ input: child.stdout }) };
  };
  const call = async (client, id, name, args) => {
    client.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`);
    const [line] = await once(client.lines, "line");
    const response = JSON.parse(line).result;
    assert.equal(response.isError, false, response.content?.[0]?.text);
    return response.structuredContent;
  };
  const lowe = launch(owner, homeLowe, loweUrl, "codex", "Atlas");
  const david = launch(peer, homeDavid, davidUrl, "claude-code", "Scout");
  const first = await call(lowe, 1, "begin_task", { summary: "Build API", scopes: ["src/api/**"] });
  const second = await call(david, 1, "begin_task", { summary: "Build UI", scopes: ["src/ui/**"] });
  assert.equal(first.session.user, "Lowe");
  assert.equal(second.session.user, "David");
  const radar = await fetch(`${loweUrl}/api/snapshot`).then((response) => response.json());
  assert.equal(radar.sessions.length, 2);
  assert.equal(radar.policy.source, "Git-native MCP");
  const collision = await post(davidUrl, "/api/tasks/begin", { agent: "cursor", agentName: "Other", summary: "Overlap", scopes: ["src/api/routes/**"] });
  assert.equal(collision.status, 409);
  assert.match(collision.value.reason, /Lowe \/ Atlas/);
  const mcpCollision = await call(david, 2, "begin_task", { summary: "Overlap", scopes: ["src/api/routes/**"] });
  assert.equal(mcpCollision.decision, "deny");
  await call(david, 3, "message_agent", { to: first.session.id, text: "I can see your API work." });
  const context = await call(lowe, 2, "get_airspace", {});
  assert.equal(context.activeWork.length, 2);
  assert.equal(context.messages.at(-1).text, "I can see your API work.");
  const allowed = await call(lowe, 3, "check_write", { path: "src/api/router.ts" });
  assert.equal(allowed.decision, "allow");
  const outside = await post(davidUrl, "/api/agent/check-write", { sessionId: second.session.id, path: "src/api/router.ts" });
  assert.equal(outside.status, 409);
  await call(lowe, 4, "complete_task", {});
  await call(david, 4, "complete_task", {});
  const finalState = await fetch(`${davidUrl}/api/snapshot`).then((response) => response.json());
  assert.equal(finalState.sessions.filter((item) => item.status === "closed").length, 2);
  const refs = execFileSync("git", ["ls-remote", bare], { encoding: "utf8" });
  assert.match(refs, /refs\/notes\/atc-radar/);
  assert.doesNotMatch(refs, /refs\/heads\/atc/);
});

test("a non-fast-forward race admits only one overlapping claim", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "atc-git-race-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const bare = join(base, "remote.git");
  execFileSync("git", ["init", "--bare", bare], { stdio: "ignore" });
  const remote = "https://github.com/example/race.git";
  const manifest = { version: 2, repository: { id: repositoryId(remote), name: "race", fingerprint: "github.com/example/race" }, transport: "git", git: { remote: "origin", ref: gitRadarRef } };
  const stores = ["init", "one", "two"].map((name) => new GitRadarStore({ root: base, manifest, remoteUrl: bare, cachePath: join(base, name) }));
  await stores[0].initialize();
  let arrived = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const claim = (store, name) => store.mutate(async (data) => {
    if (arrived < 2) { arrived++; if (arrived === 2) release(); await gate; }
    const live = data.tasks.find((task) => !task.completedAt && task.scopes.some((scope) => overlaps(scope, "src/shared/**")));
    if (live) return { changed: false, result: { decision: "deny", owner: data.sessions.find((item) => item.id === live.sessionId)?.user } };
    const state = new AtcState({ repository: manifest.repository, leaseMs: 720_000 });
    state.data = data;
    state.begin({ sessionId: `ses_${name}`, machineId: name, user: name, agent: "test", summary: "Shared change", scopes: ["src/shared/**"] });
    return { result: { decision: "allow", owner: name } };
  }, { developer: name });
  const decisions = await Promise.all([claim(stores[1], "one"), claim(stores[2], "two")]);
  assert.deepEqual(decisions.map((item) => item.decision).sort(), ["allow", "deny"]);
  const finalState = await stores[0].refresh();
  assert.equal(finalState.tasks.filter((item) => !item.completedAt).length, 1);
});
