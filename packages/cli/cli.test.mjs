import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("CLI exposes onboarding commands", () => {
  const source = readFileSync(new URL("./cli.mjs", import.meta.url), "utf8");
  for (const command of ["install", "enable", "doctor"]) assert.match(source, new RegExp(`command === \\"${command}\\"`));
  assert.match(source, /exactFileConflict: "deny"/);
});
