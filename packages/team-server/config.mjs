import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const manifestName = ".atc-team.json";

export function gitRemote(root) {
  return execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function canonicalRemote(remote) {
  let value = String(remote || "").trim();
  if (!value) throw new Error("A Git origin remote is required for a team project.");
  value = value.replace(/^([^@]+@)?([^:]+):([^/].*)$/, "ssh://$2/$3");
  try {
    const url = new URL(value);
    if (!["https:", "http:", "ssh:"].includes(url.protocol)) throw new Error("Unsupported Git remote protocol");
    return `${url.hostname.toLowerCase()}/${decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").toLowerCase()}`;
  } catch { throw new Error("Team projects require an SSH or HTTP Git origin remote."); }
}

export function repositoryId(remote) {
  return `repo_${createHash("sha256").update(canonicalRemote(remote)).digest("hex").slice(0, 16)}`;
}

export function coordinatorUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Coordinator URL must be an origin without credentials, path, query, or fragment.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("A non-loopback coordinator URL must use HTTPS.");
  return url.origin;
}

export async function readManifest(root) {
  const manifest = JSON.parse(await readFile(join(root, manifestName), "utf8"));
  if (manifest.version !== 1 || !manifest.repository?.id || !manifest.repository?.fingerprint || !manifest.coordinator?.url) throw new Error("Invalid ATC team manifest.");
  if (manifest.repository.fingerprint !== canonicalRemote(gitRemote(root)) || manifest.repository.id !== repositoryId(gitRemote(root))) throw new Error("ATC team manifest does not match this repository's Git origin.");
  coordinatorUrl(manifest.coordinator.url);
  return manifest;
}

export function atcHome() { return process.env.ATC_HOME || join(homedir(), ".atc"); }
export function credentialPath(repositoryId) { return join(atcHome(), "credentials", `${repositoryId}.json`); }
