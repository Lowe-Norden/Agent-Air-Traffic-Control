import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AtcState } from "../daemon/state.mjs";
import { readManifest } from "./config.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const secret = () => `atc_${randomBytes(32).toString("base64url")}`;
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(value));
};
const body = async (req) => {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 100_000) throw Object.assign(new Error("Request too large"), { statusCode: 413 });
  }
  try { return JSON.parse(value || "{}"); } catch { throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 }); }
};
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const equalHash = (left, right) => {
  if (!/^[a-f0-9]{64}$/.test(left || "") || !/^[a-f0-9]{64}$/.test(right || "")) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
};

export class TeamAuth {
  constructor(path, data, now = () => new Date()) {
    this.path = path;
    this.data = data;
    this.now = now;
    this.writeQueue = Promise.resolve();
  }

  static async load(path, now) {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (data.version !== 1 || !Array.isArray(data.members) || !Array.isArray(data.invites)) throw new Error("Invalid ATC team authentication state.");
    return new TeamAuth(path, data, now);
  }

  persist() {
    const contents = `${JSON.stringify(this.data, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, contents, { mode: 0o600 });
      await rename(temporary, this.path);
    });
    return this.writeQueue;
  }

  principal(token) {
    if (typeof token !== "string" || !token.startsWith("atc_")) return null;
    const candidate = hash(token);
    return this.data.members.find((member) => equalHash(member.hash, candidate)) || null;
  }

  async invite(developer) {
    developer = String(developer || "").trim().slice(0, 80);
    if (!developer) throw error("developer is required", 400);
    const code = secret();
    this.data.invites.push({ hash: hash(code), developer, expiresAt: new Date(this.now().getTime() + 86_400_000).toISOString(), usedAt: null });
    await this.persist();
    return { code, developer, expiresAt: this.data.invites.at(-1).expiresAt };
  }

  async join(code) {
    const candidate = typeof code === "string" ? hash(code) : "";
    const invite = this.data.invites.find((item) => !item.usedAt && equalHash(item.hash, candidate));
    if (!invite || Date.parse(invite.expiresAt) <= this.now().getTime()) throw error("Invite is invalid or expired", 403);
    invite.usedAt = this.now().toISOString();
    const token = secret();
    const member = { id: `dev_${randomUUID()}`, developer: invite.developer, role: "developer", hash: hash(token), createdAt: this.now().toISOString() };
    this.data.members.push(member);
    await this.persist();
    return { token, developer: member.developer, memberId: member.id };
  }
}

export async function createTeamServer({ root = process.cwd(), now = () => new Date(), html, tls } = {}) {
  root = resolve(root);
  const manifest = await readManifest(root);
  const repository = { ...manifest.repository, root: "." };
  const auth = await TeamAuth.load(join(root, ".atc", "team-auth.json"), now);
  const store = await new AtcState({ repository, statePath: join(root, ".atc", "team-airspace.json"), now }).load();
  const page = html ?? await readFile(new URL("../../apps/web/index.html", import.meta.url), "utf8");
  const clients = new Set(), browserSessions = new Map();
  const unsubscribe = store.subscribe((event) => {
    const frame = `id: ${event.sequence}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(frame);
  });
  const handler = async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(page);
      }
      if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, repositoryId: repository.id, version: 1 });
      if (req.method === "POST" && url.pathname === "/api/team/join") return json(res, 200, await auth.join((await body(req)).code));
      const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization || "")?.[1];
      const principal = auth.principal(bearer);
      if (req.method === "POST" && url.pathname === "/api/browser/login") {
        const member = auth.principal((await body(req)).token);
        if (!member) throw error("Invalid team token", 401);
        const sid = randomBytes(32).toString("base64url");
        browserSessions.set(sid, { memberId: member.id, expiresAt: now().getTime() + 43_200_000 });
        const secure = manifest.coordinator.url.startsWith("https:") ? "; Secure" : "";
        return json(res, 200, { ok: true, developer: member.developer }, { "set-cookie": `atc_browser=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
      }
      if (req.method === "POST" && url.pathname === "/api/admin/invites") {
        if (principal?.role !== "admin") throw error("Admin token required", 403);
        return json(res, 200, await auth.invite((await body(req)).developer));
      }
      const cookie = /(?:^|;\s*)atc_browser=([^;]+)/.exec(req.headers.cookie || "")?.[1];
      const browser = browserSessions.get(cookie);
      const browserAllowed = browser && browser.expiresAt > now().getTime();
      if (!principal && !(req.method === "GET" && browserAllowed)) throw error("ATC team authentication required", 401);
      if (req.method === "GET" && url.pathname === "/api/snapshot") return json(res, 200, store.snapshot());
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: ready\ndata: ${JSON.stringify({ sequence: store.data.sequence })}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (!principal) throw error("Agent bearer token required", 401);
      const owns = (sessionId) => {
        const session = store.data.sessions.find((item) => item.id === sessionId);
        if (!session || session.principalId !== principal.id) throw error("Session does not belong to this developer", 403);
      };
      if (req.method === "GET" && url.pathname === "/api/agent/context") {
        const sessionId = url.searchParams.get("sessionId");
        if (sessionId) owns(sessionId);
        return json(res, 200, store.context(sessionId));
      }
      const routes = new Map([
        ["/api/tasks/begin", (value) => {
          if (value.sessionId) owns(value.sessionId);
          return store.begin({ ...value, user: principal.developer, principalId: principal.id });
        }],
        ["/api/sessions/heartbeat", (value) => { owns(value.sessionId); return store.heartbeat(value.sessionId, value.status); }],
        ["/api/agent/check-write", (value) => { owns(value.sessionId); return store.checkWrite(value); }],
        ["/api/agent/message", (value) => { owns(value.sessionId); return store.sendMessage(value); }],
        ["/api/tasks/complete", (value) => { owns(value.sessionId); return store.completeTask(value); }],
      ]);
      if (req.method === "POST" && routes.has(url.pathname)) {
        const result = routes.get(url.pathname)(await body(req));
        await store.writeQueue;
        return json(res, result?.decision === "deny" ? 409 : 200, result);
      }
      return json(res, 404, { error: "Not found" });
    } catch (cause) { return json(res, cause.statusCode || 500, { error: cause.message || "Internal error" }); }
  };
  const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);
  server.store = store;
  server.auth = auth;
  server.on("close", () => { unsubscribe(); for (const client of clients) client.end(); });
  return server;
}

export async function listenTeam(options = {}) {
  const host = options.host || "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && !options.tls) throw new Error("Non-loopback team service requires TLS; use a local HTTPS reverse proxy or --cert and --key.");
  const server = await createTeamServer(options);
  await new Promise((done, reject) => server.once("error", reject).listen(Number(options.port ?? 3200), host, done));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) listenTeam().then((server) => console.log(`ATC team coordinator on ${server.address().address}:${server.address().port}`));
