import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const normalizePath = (value = "") => value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\//, "").replace(/\/$/, "");
const scopeRoot = (value) => normalizePath(value).replace(/\/\*\*?$/, "");
const overlaps = (scope, path) => {
  const left = scopeRoot(scope);
  const right = normalizePath(path);
  return left === right || right.startsWith(`${left}/`) || left.startsWith(`${right}/`);
};
const displayName = (session) => `${session?.user ?? "Unknown"} / ${session?.agentName || session?.agent || "Agent"}${session?.githubAccount ? ` (@${session.githubAccount})` : ""}`;
const githubAccount = (value) => {
  const login = String(value || "").trim().replace(/^@/, "");
  if (login && !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?(?:\[bot\])?$/i.test(login)) throw Object.assign(new Error("githubAccount must be a GitHub login"), { statusCode: 400 });
  return login || null;
};
const blank = (repository) => ({ version: 1, repository, sequence: 0, sessions: [], tasks: [], messages: [], collisions: [], events: [] });

export class AtcState {
  constructor({ repository, statePath, now = () => new Date() }) {
    this.repository = repository;
    this.statePath = statePath;
    this.now = now;
    this.data = blank(repository);
    this.listeners = new Set();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.statePath, "utf8"));
      if (saved?.version === 1 && saved.repository?.id === this.repository.id) this.data = saved;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.expireStale();
    return this;
  }

  expireStale() {
    const cutoff = this.now().getTime() - 90_000;
    for (const session of this.data.sessions) {
      if (["active", "idle"].includes(session.status) && Date.parse(session.lastHeartbeatAt) < cutoff) session.status = "stale";
    }
  }

  snapshot() {
    this.expireStale();
    return {
      repository: this.data.repository,
      sequence: this.data.sequence,
      sessions: this.data.sessions,
      tasks: this.data.tasks.filter((task) => !task.completedAt),
      messages: this.data.messages.slice(-100),
      collisions: this.data.collisions.filter((item) => !item.resolvedAt),
      events: this.data.events.slice(-150).reverse(),
      policy: { default: "warn", exactFileConflict: "deny", source: "local daemon + MCP", rawSourceLeavesMachine: false },
    };
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  emit(type, sessionId, payload = {}) {
    const event = { id: `evt_${randomUUID()}`, sequence: ++this.data.sequence, repositoryId: this.repository.id, timestamp: this.now().toISOString(), type, ...(sessionId ? { sessionId } : {}), payload };
    this.data.events.push(event);
    if (this.data.events.length > 1000) this.data.events.splice(0, this.data.events.length - 1000);
    this.persist();
    for (const listener of this.listeners) listener(event);
    return event;
  }

  persist() {
    const contents = `${JSON.stringify(this.data, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.statePath), { recursive: true });
      const temporary = `${this.statePath}.tmp`;
      await writeFile(temporary, contents, { mode: 0o600 });
      await rename(temporary, this.statePath);
    });
    return this.writeQueue;
  }

  startSession(input) {
    const timestamp = this.now().toISOString();
    const id = input.sessionId || `ses_${randomUUID()}`;
    let session = this.data.sessions.find((item) => item.id === id);
    const values = { id, repositoryId: this.repository.id, agent: String(input.agent || "unknown").slice(0, 80), agentName: String(input.agentName || input.agent || "Agent").slice(0, 80), user: String(input.user || "local developer").slice(0, 80), githubAccount: githubAccount(input.githubAccount), branch: String(input.branch || "unknown"), worktree: String(input.worktree || "."), capabilities: input.capabilities || { mcp: true, preWrite: false, postWrite: false }, status: "active", startedAt: session?.startedAt || timestamp, lastHeartbeatAt: timestamp };
    if (session) Object.assign(session, values); else this.data.sessions.push(session = values);
    this.emit("session.started", id, { agent: session.agent, agentName: session.agentName, user: session.user, githubAccount: session.githubAccount, branch: session.branch });
    return session;
  }

  beginTask(input) {
    const session = this.data.sessions.find((item) => item.id === input.sessionId);
    if (!session) throw Object.assign(new Error("Unknown session"), { statusCode: 404 });
    for (const task of this.data.tasks) if (task.sessionId === session.id && !task.completedAt) task.completedAt = this.now().toISOString();
    const task = { id: input.taskId || `task_${randomUUID()}`, sessionId: session.id, summary: String(input.summary || "Unspecified agent work").slice(0, 240), scopes: [...new Set((input.scopes || []).map(normalizePath).filter(Boolean))].slice(0, 50), symbols: [...new Set((input.symbols || []).map(String).filter(Boolean))].slice(0, 100), startedAt: this.now().toISOString() };
    this.data.tasks.push(task);
    session.status = "active";
    session.lastHeartbeatAt = this.now().toISOString();
    this.emit("task.started", session.id, { taskId: task.id, summary: task.summary, scopes: task.scopes });
    return { session, task, context: this.context(session.id) };
  }

  begin(input) { const session = this.startSession(input); return this.beginTask({ ...input, sessionId: session.id }); }

  heartbeat(sessionId, status = "active") {
    const session = this.data.sessions.find((item) => item.id === sessionId);
    if (!session) throw Object.assign(new Error("Unknown session"), { statusCode: 404 });
    session.lastHeartbeatAt = this.now().toISOString();
    session.status = status === "idle" ? "idle" : "active";
    this.emit("session.heartbeat", sessionId, { status: session.status });
    return { session, context: this.context(sessionId) };
  }

  context(sessionId) {
    this.expireStale();
    const live = new Set(this.data.sessions.filter((item) => ["active", "idle"].includes(item.status)).map((item) => item.id));
    return {
      repository: this.repository,
      you: this.data.sessions.find((item) => item.id === sessionId) || null,
      activeWork: this.data.tasks.filter((task) => !task.completedAt && live.has(task.sessionId)).map((task) => ({ ...task, session: this.data.sessions.find((item) => item.id === task.sessionId) })),
      messages: this.data.messages.filter((message) => message.to === "broadcast" || message.to === sessionId || message.from === sessionId).slice(-50),
      collisions: this.data.collisions.filter((item) => !item.resolvedAt && item.sessions.includes(sessionId)),
    };
  }

  checkWrite(input) {
    const path = normalizePath(input.path);
    if (!path) throw Object.assign(new Error("path is required"), { statusCode: 400 });
    const owner = this.data.sessions.find((item) => item.id === input.sessionId);
    if (!owner) throw Object.assign(new Error("Unknown session"), { statusCode: 404 });
    const liveOthers = new Set(this.data.sessions.filter((item) => item.id !== owner.id && ["active", "idle"].includes(item.status)).map((item) => item.id));
    const conflictTask = this.data.tasks.find((task) => !task.completedAt && liveOthers.has(task.sessionId) && task.scopes.some((scope) => overlaps(scope, path)));
    if (!conflictTask) {
      this.emit("file.write", owner.id, { path, decision: "allow" });
      return { decision: "allow", reason: "No active scope conflict", context: this.context(owner.id) };
    }
    const conflicting = this.data.sessions.find((item) => item.id === conflictTask.sessionId);
    const existing = this.data.collisions.find((item) => !item.resolvedAt && item.path === path && item.sessions.includes(owner.id) && item.sessions.includes(conflicting.id));
    const collision = existing || { id: `col_${randomUUID()}`, risk: "critical", path, sessions: [owner.id, conflicting.id], agents: [displayName(owner), displayName(conflicting)], guidance: `${displayName(conflicting)} is working on “${conflictTask.summary}” in ${conflictTask.scopes.join(", ")}. Coordinate before editing ${path}.`, openedAt: this.now().toISOString() };
    if (!existing) this.data.collisions.push(collision);
    this.emit("collision.detected", owner.id, { collisionId: collision.id, path, conflictingSessionId: conflicting.id });
    return { decision: "deny", collision, agentContext: `ATC DENY: ${collision.guidance}`, context: this.context(owner.id) };
  }

  sendMessage(input) {
    const from = this.data.sessions.find((item) => item.id === input.sessionId);
    if (!from) throw Object.assign(new Error("Unknown session"), { statusCode: 404 });
    const to = input.to || "broadcast";
    if (to !== "broadcast" && !this.data.sessions.some((item) => item.id === to)) throw Object.assign(new Error("Unknown recipient session"), { statusCode: 404 });
    const message = { id: `msg_${randomUUID()}`, from: from.id, fromLabel: displayName(from), to, text: String(input.text || "").trim().slice(0, 1000), timestamp: this.now().toISOString() };
    if (!message.text) throw Object.assign(new Error("text is required"), { statusCode: 400 });
    this.data.messages.push(message);
    this.emit("message.sent", from.id, { messageId: message.id, to, text: message.text });
    return { message, context: this.context(from.id) };
  }

  completeTask(input) {
    const session = this.data.sessions.find((item) => item.id === input.sessionId);
    if (!session) throw Object.assign(new Error("Unknown session"), { statusCode: 404 });
    const completedAt = this.now().toISOString();
    for (const task of this.data.tasks) if (task.sessionId === session.id && !task.completedAt) task.completedAt = completedAt;
    session.status = "closed";
    session.lastHeartbeatAt = completedAt;
    for (const collision of this.data.collisions) if (!collision.resolvedAt && collision.sessions.includes(session.id)) collision.resolvedAt = completedAt;
    this.emit("task.completed", session.id, { summary: input.summary || "Task completed" });
    this.emit("session.closed", session.id, {});
    return { completed: true, sessionId: session.id };
  }
}

export { normalizePath, overlaps };
