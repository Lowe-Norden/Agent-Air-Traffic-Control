import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AtcState, normalizePath, overlaps } from "../daemon/state.mjs";
import { gitProfilePath, readManifest } from "../team-server/config.mjs";
import { GitRadarStore } from "./store.mjs";

const leaseMs = 720_000;
const json = (res, code, value) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
const body = async (req) => {
  let data = "";
  for await (const part of req) {
    data += part;
    if (data.length > 100_000) throw Object.assign(new Error("Request too large"), { statusCode: 413 });
  }
  try { return JSON.parse(data || "{}"); } catch { throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 }); }
};
const failure = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const pathValue = (value) => {
  if (typeof value !== "string" || !value.trim() || value.startsWith("/") || /^[a-zA-Z]:/.test(value) || value.replaceAll("\\", "/").split("/").includes("..")) throw failure("A repository-relative path is required");
  return normalizePath(value);
};
const covers = (scope, path) => {
  const root = normalizePath(scope).replace(/\/\*\*?$/, "");
  return path === root || path.startsWith(`${root}/`);
};

export async function createGitServer({ root = process.cwd(), now = () => new Date(), remoteUrl, cachePath, html, pollMs = 30_000 } = {}) {
  root = resolve(root);
  const manifest = await readManifest(root);
  if (manifest.version !== 2 || manifest.transport !== "git") throw new Error("This repository is not configured for Git-native ATC.");
  const profile = JSON.parse(await readFile(gitProfilePath(manifest.repository.id), "utf8"));
  if (profile.repositoryId !== manifest.repository.id || !profile.machineId || !profile.developer) throw new Error("ATC Git profile is missing or invalid. Run `atc team connect --developer NAME`.");
  const store = new GitRadarStore({ root, manifest, remoteUrl, cachePath, now });
  await store.refresh();
  const page = html ?? await readFile(new URL("../../apps/web/index.html", import.meta.url), "utf8");
  const clients = new Set(), localHeartbeats = new Map();
  let lastPresencePush = now().getTime();
  const repository = { ...manifest.repository, root: "." };
  const view = (data = store.data) => {
    const state = new AtcState({ repository, now, leaseMs });
    state.data = structuredClone(data);
    state.expireStale();
    return state;
  };
  const owns = (data, sessionId) => {
    const session = data.sessions.find((item) => item.id === sessionId);
    if (!session || session.machineId !== profile.machineId) throw failure("Session does not belong to this machine", 403);
    return session;
  };
  const mutate = (operation) => store.mutate((data) => {
    const state = new AtcState({ repository, now, leaseMs });
    state.data = data;
    const result = operation(state);
    return { result, changed: result?.decision !== "deny" };
  }, { developer: profile.developer });
  const publish = () => {
    const frame = `event: update\ndata: ${JSON.stringify({ sequence: store.data.sequence, syncedAt: store.syncedAt })}\n\n`;
    for (const client of clients) client.write(frame);
  };
  const unsubscribe = store.subscribe(publish);
  const poll = setInterval(() => store.refresh().catch(() => {
    for (const client of clients) client.write(`event: stale\ndata: ${JSON.stringify({ syncedAt: store.syncedAt })}\n\n`);
  }), pollMs);
  poll.unref();

  const handler = async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(page); }
      if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, mode: "git", repositoryId: repository.id, syncedAt: store.syncedAt });
      if (req.method === "GET" && url.pathname === "/api/snapshot") {
        await store.refresh();
        return json(res, 200, { ...view().snapshot(), syncedAt: store.syncedAt, policy: { default: "warn", exactFileConflict: "deny", source: "Git-native MCP", rawSourceLeavesMachine: false } });
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: ready\ndata: ${JSON.stringify({ sequence: store.data.sequence })}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/agent/context") {
        await store.refresh();
        const sessionId = url.searchParams.get("sessionId");
        if (sessionId) owns(store.data, sessionId);
        return json(res, 200, view().context(sessionId));
      }
      if (req.method !== "POST") return json(res, 404, { error: "Not found" });
      const input = await body(req);
      if (url.pathname === "/api/tasks/begin") {
        const scopes = Array.isArray(input.scopes) ? input.scopes.map(pathValue) : [];
        const result = await mutate((state) => {
          if (input.sessionId) owns(state.data, input.sessionId);
          state.expireStale();
          const live = new Set(state.data.sessions.filter((item) => ["active", "idle"].includes(item.status) && item.id !== input.sessionId).map((item) => item.id));
          const conflict = state.data.tasks.find((task) => !task.completedAt && live.has(task.sessionId) && task.scopes.some((scope) => scopes.some((next) => overlaps(scope, next))));
          if (conflict) {
            const owner = state.data.sessions.find((item) => item.id === conflict.sessionId);
            return { decision: "deny", reason: `${owner?.user || "Another developer"} / ${owner?.agentName || owner?.agent || "Agent"} already claims ${conflict.scopes.join(", ")} for ${conflict.summary}.`, conflictingSessionId: conflict.sessionId };
          }
          return state.begin({ ...input, scopes, user: profile.developer, machineId: profile.machineId });
        });
        if (result.decision === "deny") return json(res, 409, result);
        lastPresencePush = now().getTime();
        return json(res, 200, result);
      }
      if (url.pathname === "/api/sessions/heartbeat") {
        owns(store.data, input.sessionId);
        localHeartbeats.set(input.sessionId, { timestamp: now().toISOString(), status: input.status === "idle" ? "idle" : "active" });
        if (now().getTime() - lastPresencePush >= 300_000) {
          await mutate((state) => {
            for (const [id, heartbeat] of localHeartbeats) if (state.data.sessions.some((item) => item.id === id && item.machineId === profile.machineId && item.status !== "closed")) state.heartbeat(id, heartbeat.status);
            return { ok: true };
          });
          localHeartbeats.clear();
          lastPresencePush = now().getTime();
        }
        return json(res, 200, { session: view().data.sessions.find((item) => item.id === input.sessionId), context: view().context(input.sessionId) });
      }
      if (url.pathname === "/api/agent/check-write") {
        const path = pathValue(input.path);
        await store.refresh();
        owns(store.data, input.sessionId);
        const ownTask = store.data.tasks.find((item) => item.sessionId === input.sessionId && !item.completedAt);
        if (!ownTask?.scopes.some((scope) => covers(scope, path))) return json(res, 409, { decision: "deny", reason: "Path is outside this agent's claimed scope; begin a task with that scope first." });
        const result = view().checkWrite({ sessionId: input.sessionId, path });
        return json(res, result.decision === "deny" ? 409 : 200, result);
      }
      if (url.pathname === "/api/agent/message") {
        const result = await mutate((state) => { owns(state.data, input.sessionId); return state.sendMessage(input); });
        return json(res, 200, result);
      }
      if (url.pathname === "/api/tasks/complete") {
        const result = await mutate((state) => { owns(state.data, input.sessionId); return state.completeTask(input); });
        localHeartbeats.delete(input.sessionId);
        return json(res, 200, result);
      }
      return json(res, 404, { error: "Not found" });
    } catch (error) { return json(res, error.statusCode || 503, { error: error.message || "ATC Git state unavailable" }); }
  };
  const server = createServer(handler);
  server.store = store;
  server.on("close", () => { clearInterval(poll); unsubscribe(); for (const client of clients) client.end(); });
  return server;
}

export async function listenGit(options = {}) {
  const host = options.host || "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("Git-native Radar must bind to loopback.");
  const server = await createGitServer(options);
  await new Promise((done, reject) => server.once("error", reject).listen(Number(options.port ?? 3000), host, done));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) listenGit({ root: process.env.ATC_REPO || process.cwd(), port: process.env.ATC_PORT || 3000 }).then((server) => console.log(`ATC Git Radar on ${server.address().address}:${server.address().port}`));
