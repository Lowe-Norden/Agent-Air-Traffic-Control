import test from "node:test";
import assert from "node:assert/strict";
test("prototype contract documents mixed-agent protection", () => {
  const supported = ["Codex", "Claude Code", "Cursor", "DeepSeek"];
  assert.equal(new Set(supported).size, 4);
});
