import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { canonicalRemote, coordinatorUrl, credentialPath, gitProfilePath, gitRadarRef, gitRemote, manifestName, readManifest, repositoryId } from "../team-server/config.mjs";
import { listenTeam } from "../team-server/server.mjs";
import { GitRadarStore } from "../git-team/store.mjs";
import { listenGit } from "../git-team/server.mjs";

const option = (args, name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const request = async (url, path, token, value) => {
  const response = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `ATC HTTP ${response.status}`);
  return result;
};

export function initTeam(root, url) {
  if (!url) throw new Error("Usage: atc team init --url https://atc.example.internal");
  const manifestPath = join(root, manifestName);
  if (existsSync(manifestPath)) throw new Error("This repository already has an ATC team manifest.");
  const fingerprint = canonicalRemote(gitRemote(root));
  const repository = { id: repositoryId(gitRemote(root)), name: basename(root), fingerprint };
  const manifest = { version: 1, repository, coordinator: { url: coordinatorUrl(url) } };
  const adminToken = `atc_${randomBytes(32).toString("base64url")}`;
  const atcDir = join(root, ".atc");
  mkdirSync(atcDir, { recursive: true });
  writeFileSync(join(atcDir, "team-admin-token"), `${adminToken}\n`, { mode: 0o600, flag: "wx" });
  writeFileSync(join(atcDir, "team-auth.json"), `${JSON.stringify({ version: 1, members: [{ id: `admin_${randomUUID()}`, developer: "Team owner", role: "admin", hash: createHash("sha256").update(adminToken).digest("hex"), createdAt: new Date().toISOString() }], invites: [] }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  const ignorePath = join(root, ".gitignore"), ignore = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  if (!ignore.split(/\r?\n/).includes(".atc/")) writeFileSync(ignorePath, `${ignore.replace(/\s*$/, "")}\n.atc/\n`);
  return manifest;
}

export async function inviteTeam(root, developer) {
  const manifest = await readManifest(root);
  const adminToken = (await readFile(join(root, ".atc", "team-admin-token"), "utf8")).trim();
  return request(manifest.coordinator.url, "/api/admin/invites", adminToken, { developer });
}

export async function joinTeam(root, code) {
  if (!code) throw new Error("Usage: atc team join INVITE_CODE");
  const manifest = await readManifest(root);
  const joined = await request(manifest.coordinator.url, "/api/team/join", null, { code });
  const path = credentialPath(manifest.repository.id);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ version: 1, repositoryId: manifest.repository.id, coordinator: manifest.coordinator.url, developer: joined.developer, memberId: joined.memberId, token: joined.token }, null, 2)}\n`, { mode: 0o600 });
  return { developer: joined.developer, path };
}

export async function teamCredential(root) {
  const manifest = await readManifest(root);
  const value = JSON.parse(await readFile(credentialPath(manifest.repository.id), "utf8"));
  if (value.repositoryId !== manifest.repository.id || value.coordinator !== manifest.coordinator.url || !value.token) throw new Error("ATC team credential does not match this project.");
  return { manifest, credential: value };
}

export async function initGitTeam(root) {
  const manifestPath = join(root, manifestName);
  if (existsSync(manifestPath)) throw new Error("This repository already has an ATC team manifest.");
  const remoteUrl = gitRemote(root);
  const repository = { id: repositoryId(remoteUrl), name: basename(root), fingerprint: canonicalRemote(remoteUrl) };
  const manifest = { version: 2, repository, transport: "git", git: { remote: "origin", ref: gitRadarRef } };
  const store = new GitRadarStore({ root, manifest });
  await store.initialize("ATC setup");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

export async function connectGitTeam(root, developer) {
  const manifest = await readManifest(root);
  if (manifest.version !== 2) throw new Error("This project uses coordinator invitations; run `atc team join`.");
  developer = String(developer || "").trim().slice(0, 80);
  if (!developer) throw new Error("Usage: atc team connect --developer NAME");
  const path = gitProfilePath(manifest.repository.id);
  let existing;
  try { existing = JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const profile = { version: 1, repositoryId: manifest.repository.id, machineId: existing?.machineId || `machine_${randomUUID()}`, developer };
  const store = new GitRadarStore({ root, manifest });
  await store.mutate((data) => {
    const event = { id: `evt_${randomUUID()}`, sequence: ++data.sequence, repositoryId: manifest.repository.id, timestamp: new Date().toISOString(), type: "machine.connected", payload: { machineId: profile.machineId, developer } };
    data.events.push(event);
    if (data.events.length > 300) data.events.splice(0, data.events.length - 300);
    return { result: profile };
  }, { developer });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  return { profile, path };
}

export async function runTeam(root, args) {
  const [command, ...options] = args;
  if (command === "init") {
    if (option(options, "--transport") === "git") {
      const manifest = await initGitTeam(root);
      console.log(`Git-native ATC initialized for ${manifest.repository.name}. Ref: ${manifest.git.ref}\nCommit ${manifestName}. Each developer runs atc team connect --developer NAME.`);
      return;
    }
    const manifest = initTeam(root, option(options, "--url"));
    console.log(`ATC team project initialized: ${manifest.repository.name}\nCoordinator: ${manifest.coordinator.url}\nCommit ${manifestName} and .gitignore. Keep .atc/ private. Start the coordinator, then invite each developer.`);
  } else if (command === "serve") {
    const manifest = await readManifest(root);
    if (manifest.version === 2) {
      const server = await listenGit({ root, port: Number(option(options, "--port", "3000")) });
      console.log(`ATC Git Radar ready at http://127.0.0.1:${server.address().port}`);
      return;
    }
    const certPath = option(options, "--cert"), keyPath = option(options, "--key");
    if (!!certPath !== !!keyPath) throw new Error("Provide both --cert and --key for direct TLS.");
    const tls = certPath ? { cert: await readFile(certPath), key: await readFile(keyPath) } : undefined;
    const host = option(options, "--host", "127.0.0.1"), port = Number(option(options, "--port", "3200"));
    const server = await listenTeam({ root, host, port, tls });
    console.log(`ATC team coordinator ready on ${host}:${server.address().port}`);
  } else if (command === "invite") {
    const result = await inviteTeam(root, option(options, "--developer"));
    console.log(`Invite for ${result.developer} (expires ${result.expiresAt}): ${result.code}\nSend this code privately. It can be used once.`);
  } else if (command === "join") {
    const result = await joinTeam(root, options[0]);
    console.log(`Joined ATC as ${result.developer}. Credential stored outside Git at ${result.path}.`);
  } else if (command === "connect") {
    const result = await connectGitTeam(root, option(options, "--developer"));
    console.log(`Connected to Git-native ATC as ${result.profile.developer}. Profile: ${result.path}. No ATC token was created.`);
  } else if (command === "status") {
    const currentManifest = await readManifest(root);
    if (currentManifest.version === 2) {
      const store = new GitRadarStore({ root, manifest: currentManifest });
      const state = await store.refresh();
      console.log(`ATC Git Radar: ${currentManifest.repository.name}\nSequence: ${state.sequence}\nRef: ${currentManifest.git.ref}\nSynced: ${store.syncedAt}`);
      return;
    }
    const { manifest, credential } = await teamCredential(root);
    const response = await fetch(`${manifest.coordinator.url}/api/snapshot`, { headers: { authorization: `Bearer ${credential.token}` } });
    console.log(`ATC team: ${manifest.repository.name}\nDeveloper: ${credential.developer}\nCoordinator: ${response.ok ? "online" : `HTTP ${response.status}`}`);
  } else if (command === "radar") {
    const currentManifest = await readManifest(root);
    if (currentManifest.version === 2) {
      try {
        const response = await fetch("http://127.0.0.1:3000/api/health");
        const health = await response.json();
        if (health.mode === "git" && health.repositoryId === currentManifest.repository.id) { console.log("Open http://127.0.0.1:3000 for your shared team Radar."); return; }
      } catch {}
      const server = await listenGit({ root });
      console.log(`Open http://127.0.0.1:${server.address().port} for your shared team Radar. Keep this terminal open.`);
      return;
    }
    const { manifest, credential } = await teamCredential(root);
    console.log(`Open ${manifest.coordinator.url}/ and paste this private browser login token:\n${credential.token}\nDo not share or commit this token.`);
  } else throw new Error("Usage: atc team <init|serve|invite|join|connect|status|radar>");
}
