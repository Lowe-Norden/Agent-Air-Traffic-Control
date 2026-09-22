import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { AtcState } from "./state.mjs";

const sendJson = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
};
const readBody = async (req) => {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 1_000_000) throw Object.assign(new Error("Request too large"), { statusCode: 413 });
  }
  try { return JSON.parse(value || "{}"); } catch { throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 }); }
};
const fallbackId = (root) => `repo_${createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 16)}`;

export async function repositoryConfig(root) {
  try {
    const config = JSON.parse(await readFile(join(root, ".atc", "config.json"), "utf8"));
    return { ...config.repository, id: config.repository?.id || fallbackId(root), name: config.repository?.name || basename(root), root };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { id: fallbackId(root), name: basename(root), fingerprint: "local-only", root };
  }
}

export async function createAtcServer({ root = process.env.ATC_REPO || process.cwd(), statePath, html, now } = {}) {
  root = resolve(root);
  const repository = await repositoryConfig(root);
  const store = await new AtcState({ repository, statePath: statePath || join(root, ".atc", "state.json"), now }).load();
  const page = html ?? await readFile(new URL("../../apps/web/index.html", import.meta.url), "utf8");
  const clients = new Set();
  const unsubscribe = store.subscribe((event) => {
    const frame = `id: ${event.sequence}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(frame);
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(page);
      }
      if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true, repository, sequence: store.data.sequence });
      if (req.method === "GET" && url.pathname === "/api/snapshot") return sendJson(res, 200, store.snapshot());
      if (req.method === "GET" && url.pathname === "/api/agent/context") return sendJson(res, 200, store.context(url.searchParams.get("sessionId")));
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: ready\ndata: ${JSON.stringify({ sequence: store.data.sequence })}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      const routes = new Map([
        ["/api/tasks/begin", (value) => store.begin(value)],
        ["/api/sessions/heartbeat", (value) => store.heartbeat(value.sessionId, value.status)],
        ["/api/agent/check-write", (value) => store.checkWrite(value)],
        ["/api/agent/message", (value) => store.sendMessage(value)],
        ["/api/tasks/complete", (value) => store.completeTask(value)],
      ]);
      if (req.method === "POST" && routes.has(url.pathname)) {
        const result = routes.get(url.pathname)(await readBody(req));
        return sendJson(res, result?.decision === "deny" ? 409 : 200, result);
      }
      return sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, { error: error.message || "Internal error" });
    }
  });
  server.store = store;
  server.on("close", () => { unsubscribe(); for (const client of clients) client.end(); });
  return server;
}

export async function listen(options = {}) {
  const server = await createAtcServer(options);
  const host = options.host || process.env.ATC_HOST || "127.0.0.1";
  const port = Number(options.port ?? process.env.ATC_PORT ?? 3000);
  await new Promise((resolveListen, reject) => server.once("error", reject).listen(port, host, resolveListen));
  console.log(`ATC ready for ${server.store.repository.name}: http://${host}:${server.address().port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) listen();
