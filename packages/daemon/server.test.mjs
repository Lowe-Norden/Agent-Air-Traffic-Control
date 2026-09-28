import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAtcServer } from "./server.mjs";

test("HTTP API serves one real repository airspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "atc-api-"));
  await mkdir(join(root, ".atc"));
  await writeFile(join(root, ".atc", "config.json"), JSON.stringify({ repository: { id: "repo_api", name: "API fixture" } }));
  const server = await createAtcServer({ root, html: "ok" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await server.store.writeQueue;
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const started = await fetch(`${base}/api/tasks/begin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: "codex", user: "Lowe", summary: "Test", scopes: ["src/**"] }) }).then((response) => response.json());
  assert.ok(started.session.id);
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) => response.json());
  assert.equal(snapshot.repository.name, "API fixture");
  assert.equal(snapshot.sessions[0].agent, "codex");
  assert.equal(snapshot.tasks[0].summary, "Test");
  await server.store.writeQueue;
});
