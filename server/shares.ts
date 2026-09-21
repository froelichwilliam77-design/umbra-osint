import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SHARE_MAX_PER_CASE, SHARE_MAX_TOTAL } from "../shared/scan-limits.ts";
import type { CaseShare, SavedCase, SharedCaseView, ShareRole } from "../shared/types.ts";
import { casesDir, getCase } from "./cases.ts";

const memory = new Map<string, CaseShare>();

function canWrite(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, ".umbra-write");
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function sharesDir(): string | null {
  try {
    const env = process.env.UMBRA_SHARES_DIR?.trim();
    if (env) return canWrite(env) ? env : null;
    const cases = casesDir();
    if (cases) {
      const nested = join(cases, "_shares");
      return canWrite(nested) ? nested : null;
    }
    const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || "/data";
    const nested = join(mount, "shares");
    return canWrite(nested) ? nested : null;
  } catch {
    return null;
  }
}

export function sharesPersistMode(): "volume" | "memory" {
  return sharesDir() ? "volume" : "memory";
}

function fileFor(dir: string, token: string): string {
  return join(dir, `${token.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function persistShare(rec: CaseShare): CaseShare {
  memory.set(rec.token, rec);
  const dir = sharesDir();
  if (dir) {
    try {
      writeFileSync(fileFor(dir, rec.token), JSON.stringify(rec));
    } catch {
      /* optional */
    }
  }
  return rec;
}

function loadDisk(): void {
  const dir = sharesDir();
  if (!dir) return;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const rec = readJson<CaseShare>(join(dir, f));
      if (rec?.token) memory.set(rec.token, rec);
    }
  } catch {
    /* ignore */
  }
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

function newAccessCode(): string {
  return randomBytes(4).toString("hex");
}

export function listShares(caseId?: string): CaseShare[] {
  loadDisk();
  return [...memory.values()]
    .filter((s) => (caseId ? s.caseId === caseId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getShare(token: string): CaseShare | null {
  loadDisk();
  const direct = memory.get(token);
  if (direct) return direct;
  const lower = token.trim().toLowerCase();
  if (lower.length >= 6 && lower.length <= 12) {
    return [...memory.values()].find((s) => s.accessCode?.toLowerCase() === lower) ?? null;
  }
  return null;
}

export function shareIsLive(rec: CaseShare, now = Date.now()): boolean {
  if (rec.revokedAt) return false;
  if (rec.expiresAt && Date.parse(rec.expiresAt) <= now) return false;
  return true;
}

export function createShare(input: {
  caseId: string;
  expiresInHours?: number | null;
  label?: string;
  role?: ShareRole;
}): CaseShare {
  const rec = getCase(input.caseId);
  if (!rec) throw new Error("case not found");
  if (memory.size === 0) loadDisk();
  const live = listShares().filter((s) => shareIsLive(s));
  if (live.length >= SHARE_MAX_TOTAL) throw new Error(`At most ${SHARE_MAX_TOTAL} live share links`);
  const forCase = live.filter((s) => s.caseId === input.caseId);
  if (forCase.length >= SHARE_MAX_PER_CASE) throw new Error(`At most ${SHARE_MAX_PER_CASE} live links per case`);
  const now = new Date().toISOString();
  const hours = input.expiresInHours;
  const expiresAt =
    hours != null && Number.isFinite(hours) && hours > 0
      ? new Date(Date.now() + Math.trunc(hours) * 3600_000).toISOString()
      : undefined;
  const role: ShareRole = input.role === "write" ? "write" : "read";
  return persistShare({
    token: newToken(),
    caseId: rec.id,
    createdAt: now,
    expiresAt,
    label: input.label?.trim() || undefined,
    role,
    accessCode: newAccessCode(),
  });
}

export function revokeShare(token: string): CaseShare | null {
  const rec = getShare(token);
  if (!rec) return null;
  rec.revokedAt = new Date().toISOString();
  return persistShare(rec);
}

export function deleteShare(token: string): boolean {
  loadDisk();
  const had = memory.delete(token);
  const dir = sharesDir();
  if (dir) {
    try {
      unlinkSync(fileFor(dir, token));
    } catch {
      return had;
    }
  }
  return had;
}

/** Read-only public-OSINT snapshot. No env, keys, webhooks, or body excerpts. */
export function publicShareView(token: string, expectedCaseId?: string): SharedCaseView | null {
  const share = getShare(token);
  if (!share || !shareIsLive(share)) return null;
  if (expectedCaseId && share.caseId !== expectedCaseId) return null;
  const rec = getCase(share.caseId);
  if (!rec) return null;
  return sanitizeCase(share, rec);
}

export function sanitizeCase(share: CaseShare, rec: SavedCase): SharedCaseView {
  const foundRows = rec.foundRows.map((row) => {
    const { bodyExcerpt: _drop, ...rest } = row;
    return rest;
  });
  const role: ShareRole = share.role === "write" ? "write" : "read";
  return {
    readOnly: role !== "write",
    role,
    token: share.token,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    query: rec.query,
    mode: rec.mode,
    savedAt: rec.savedAt,
    found: rec.found,
    dossier: rec.summary.dossier,
    foundRows,
    graph: rec.graph ?? rec.summary.graph,
    avatarClusters: rec.summary.avatarClusters,
    identityClusters: rec.summary.identityClusters,
    notes: rec.notes ?? [],
    progress: rec.summary.progress,
    profile: rec.summary.profile,
    shareNote:
      role === "write"
        ? "Write share: anyone with this link can add operator notes on this case. Not a full team IdP — revoke to kill access. No per-user accounts."
        : "Read-only public-OSINT snapshot. No env, keys, or private excerpts.",
  };
}

export function sharePath(token: string): string {
  return `/share/${token}`;
}

export function shareQueryPath(caseId: string, token: string): string {
  return `/c/${encodeURIComponent(caseId)}?token=${encodeURIComponent(token)}`;
}

export function resetSharesForTests(): void {
  memory.clear();
}
