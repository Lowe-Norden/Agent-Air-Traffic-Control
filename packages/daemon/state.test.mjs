import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AtcState } from "./state.mjs";

test("agents share airspace, messages, and deterministic write decisions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "atc-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await new AtcState({ repository: { id: "repo_test", name: "test", root }, statePath: join(root, "state.json") }).load();
  const alpha = store.begin({ agent: "codex", user: "Lowe", summary: "Build API", scopes: ["src/api/**"] });
  const beta = store.begin({ agent: "claude-code", user: "David", summary: "Build UI", scopes: ["src/ui/**"] });
  assert.equal(store.checkWrite({ sessionId: alpha.session.id, path: "src/api/router.ts" }).decision, "allow");
  const denied = store.checkWrite({ sessionId: beta.session.id, path: "src/api/router.ts" });
  assert.equal(denied.decision, "deny");
  assert.match(denied.agentContext, /Build API/);
  store.sendMessage({ sessionId: beta.session.id, to: alpha.session.id, text: "Can you expose the route type?" });
  assert.equal(store.context(alpha.session.id).messages.at(-1).text, "Can you expose the route type?");
  store.completeTask({ sessionId: alpha.session.id });
  assert.equal(store.checkWrite({ sessionId: beta.session.id, path: "src/api/router.ts" }).decision, "allow");
  await store.writeQueue;
});
