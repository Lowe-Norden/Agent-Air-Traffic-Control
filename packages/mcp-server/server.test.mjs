import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("MCP server publishes the complete coordination tool surface", async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);
  const [chunk] = await once(child.stdout, "data");
  const response = JSON.parse(chunk.toString().trim());
  assert.deepEqual(response.result.tools.map((tool) => tool.name), ["begin_task", "get_airspace", "check_write", "heartbeat", "message_agent", "complete_task"]);
});
