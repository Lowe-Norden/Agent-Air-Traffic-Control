import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRemote, coordinatorUrl, repositoryId } from "./config.mjs";

test("SSH and HTTPS clones have the same team repository identity", () => {
  assert.equal(canonicalRemote("git@github.com:Lowe-Norden/norden-ai-platform.git"), "github.com/lowe-norden/norden-ai-platform");
  assert.equal(canonicalRemote("https://github.com/Lowe-Norden/norden-ai-platform.git"), "github.com/lowe-norden/norden-ai-platform");
  assert.equal(repositoryId("git@github.com:Lowe-Norden/norden-ai-platform.git"), repositoryId("https://github.com/Lowe-Norden/norden-ai-platform.git"));
});

test("remote coordinator URLs require HTTPS except loopback", () => {
  assert.equal(coordinatorUrl("http://127.0.0.1:3200"), "http://127.0.0.1:3200");
  assert.equal(coordinatorUrl("https://atc.norden.internal"), "https://atc.norden.internal");
  assert.throws(() => coordinatorUrl("http://atc.norden.internal"), /HTTPS/);
  assert.throws(() => coordinatorUrl("https://user:secret@atc.norden.internal"), /without credentials/);
});
