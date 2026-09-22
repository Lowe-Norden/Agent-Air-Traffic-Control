import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("dashboard consumes persisted daemon state over snapshot and SSE", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /\/api\/snapshot/);
  assert.match(html, /EventSource\('\/api\/events'\)/);
  assert.doesNotMatch(html, /setInterval/);
  assert.match(html, /Active agents/);
  assert.match(html, /Coordination/);
});
