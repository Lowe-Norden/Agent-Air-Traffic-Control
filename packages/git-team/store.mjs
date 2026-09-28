import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { atcHome, gitRadarRef, gitRemote } from "../team-server/config.mjs";
import { AtcState } from "../daemon/state.mjs";

const run = (cwd, args, input, extraEnv = {}) => execFileSync("git", args, {
  cwd, input, encoding: "utf8", timeout: 20_000, maxBuffer: 2_000_000,
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extraEnv },
  stdio: ["pipe", "pipe", "pipe"],
}).trim();

function validateState(value, repositoryId) {
  if (value?.version !== 1 || value.repository?.id !== repositoryId || !Number.isSafeInteger(value.sequence) || !Array.isArray(value.sessions) || !Array.isArray(value.tasks) || !Array.isArray(value.messages) || !Array.isArray(value.events)) throw new Error("ATC Git Radar state is invalid or belongs to another repository.");
  return value;
}

export class GitRadarStore {
  constructor({ root, manifest, remoteUrl, cachePath, now = () => new Date() }) {
    this.root = root;
    this.manifest = manifest;
    this.remoteUrl = remoteUrl || gitRemote(root, manifest.git.remote);
    if (/^https?:\/\//.test(this.remoteUrl) && (new URL(this.remoteUrl).username || new URL(this.remoteUrl).password)) throw new Error("Git remote URLs with embedded credentials are not supported by ATC.");
    this.cachePath = cachePath || join(atcHome(), "git-cache", manifest.repository.id);
    this.now = now;
    this.tip = null;
    this.data = null;
    this.syncedAt = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.prepare();
  }

  prepare() {
    if (!existsSync(join(this.cachePath, "HEAD"))) {
      mkdirSync(this.cachePath, { recursive: true });
      run(this.cachePath, ["init", "--bare"]);
    }
    try { run(this.cachePath, ["remote", "set-url", "origin", this.remoteUrl]); }
    catch { run(this.cachePath, ["remote", "add", "origin", this.remoteUrl]); }
  }

  remoteTip() {
    const line = run(this.cachePath, ["ls-remote", "origin", gitRadarRef]);
    return line ? line.split(/\s+/)[0] : null;
  }

  async refresh({ required = true } = {}) {
    const tip = this.remoteTip();
    if (!tip) {
      if (required) throw new Error("ATC Git Radar ref is missing. Run `atc team init --transport git`.");
      return null;
    }
    if (tip !== this.tip) {
      run(this.cachePath, ["fetch", "--no-tags", "origin", gitRadarRef]);
      if (this.tip) {
        try { run(this.cachePath, ["merge-base", "--is-ancestor", this.tip, tip]); }
        catch { throw new Error("ATC Git Radar ref was rewritten; state cannot be trusted until reconnected."); }
      }
      const raw = run(this.cachePath, ["show", `${tip}:state.json`]);
      if (raw.length > 1_000_000) throw new Error("ATC Git Radar state exceeds its size limit.");
      this.data = validateState(JSON.parse(raw), this.manifest.repository.id);
      this.tip = tip;
      for (const listener of this.listeners) listener(this.data);
    }
    this.syncedAt = this.now().toISOString();
    return this.data;
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  commit(data, parent, developer = "ATC") {
    const contents = `${JSON.stringify(data)}\n`;
    if (contents.length > 1_000_000) throw new Error("ATC Git Radar state exceeds its size limit.");
    const blob = run(this.cachePath, ["hash-object", "-w", "--stdin"], contents);
    const tree = run(this.cachePath, ["mktree"], `100644 blob ${blob}\tstate.json\n`);
    const name = String(developer).replace(/[\r\n<>]/g, "").slice(0, 80) || "ATC";
    const env = { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name, GIT_AUTHOR_EMAIL: "atc@local.invalid", GIT_COMMITTER_EMAIL: "atc@local.invalid" };
    return run(this.cachePath, ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", "ATC Radar metadata [skip ci]"], undefined, env);
  }

  async initialize(developer = "ATC") {
    if (await this.refresh({ required: false })) throw new Error("ATC Git Radar is already initialized for this repository.");
    const state = new AtcState({ repository: { ...this.manifest.repository, root: "." }, now: this.now, leaseMs: 720_000 });
    const commit = this.commit(state.data, null, developer);
    run(this.cachePath, ["push", "origin", `${commit}:${gitRadarRef}`]);
    this.tip = null;
    return this.refresh();
  }

  async mutate(operation, { developer = "ATC", attempts = 6 } = {}) {
    const work = async () => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        await this.refresh();
        const base = this.tip;
        const candidate = structuredClone(this.data);
        const outcome = await operation(candidate);
        if (outcome?.changed === false) return outcome.result;
        candidate.sessions = candidate.sessions.filter((item) => item.status !== "closed").concat(candidate.sessions.filter((item) => item.status === "closed").slice(-100));
        candidate.tasks = candidate.tasks.filter((item) => !item.completedAt).concat(candidate.tasks.filter((item) => item.completedAt).slice(-100));
        candidate.messages = candidate.messages.slice(-100);
        candidate.collisions = candidate.collisions.slice(-100);
        candidate.events = candidate.events.slice(0, 300);
        validateState(candidate, this.manifest.repository.id);
        const commit = this.commit(candidate, base, developer);
        try {
          run(this.cachePath, ["push", "origin", `${commit}:${gitRadarRef}`]);
          this.tip = commit;
          this.data = candidate;
          this.syncedAt = this.now().toISOString();
          for (const listener of this.listeners) listener(this.data);
          return outcome.result;
        } catch (error) {
          const remote = this.remoteTip();
          if (remote && remote !== commit) {
            run(this.cachePath, ["fetch", "--no-tags", "origin", gitRadarRef]);
          }
          let accepted = remote === commit;
          if (remote && !accepted) {
            try { run(this.cachePath, ["merge-base", "--is-ancestor", commit, remote]); accepted = true; } catch {}
          }
          if (accepted) {
            this.tip = commit;
            this.data = candidate;
            this.syncedAt = this.now().toISOString();
            for (const listener of this.listeners) listener(this.data);
            return outcome.result;
          }
          if (remote === base) throw new Error(`ATC Git push failed: ${error.stderr?.toString().trim() || error.message}`);
          this.tip = null;
        }
      }
      throw new Error("ATC Git Radar changed repeatedly; retry the operation.");
    };
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }
}
