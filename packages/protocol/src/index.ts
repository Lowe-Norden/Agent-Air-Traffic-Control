import { z } from "zod";

export const protocolVersion = 1 as const;

export const agentTypeSchema = z.enum(["codex", "claude-code", "unknown"]);
export type AgentType = z.infer<typeof agentTypeSchema>;

export const capabilitySetSchema = z.object({
  sessionStart: z.boolean(),
  sessionStop: z.boolean(),
  preTool: z.boolean(),
  postTool: z.boolean(),
  preWrite: z.boolean(),
  postWrite: z.boolean(),
  contextInjection: z.boolean(),
  mcp: z.boolean(),
});
export type CapabilitySet = z.infer<typeof capabilitySetSchema>;

export const scopeTypeSchema = z.enum([
  "directory",
  "file",
  "symbol",
  "package",
  "dependency",
]);

export const scopeClaimSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  type: scopeTypeSchema,
  scope: z.string().min(1),
  source: z.enum(["declared", "observed", "dependency"]),
  confidence: z.number().min(0).max(1),
  leaseExpiresAt: z.string().datetime(),
});
export type ScopeClaim = z.infer<typeof scopeClaimSchema>;

export const sessionSchema = z.object({
  id: z.string().min(1),
  repositoryId: z.string().min(1),
  userId: z.string().min(1),
  machineId: z.string().min(1),
  agentType: agentTypeSchema,
  branch: z.string().min(1),
  worktree: z.string().min(1),
  status: z.enum(["active", "idle", "stale", "closed"]),
  capabilities: capabilitySetSchema,
  startedAt: z.string().datetime(),
  lastHeartbeatAt: z.string().datetime(),
});
export type AgentSession = z.infer<typeof sessionSchema>;

export const taskSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  summary: z.string().min(1).max(240),
  expectedScopes: z.array(z.string().min(1)).max(50),
  expectedSymbols: z.array(z.string().min(1)).max(100),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const eventTypeSchema = z.enum([
  "session.started",
  "session.heartbeat",
  "session.stale",
  "session.closed",
  "task.started",
  "task.updated",
  "task.completed",
  "scope.claimed",
  "scope.expanded",
  "scope.released",
  "file.write",
  "file.deleted",
  "collision.detected",
  "collision.updated",
  "collision.resolved",
  "message.sent",
]);

export const eventEnvelopeSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  workspaceId: z.string().min(1),
  repositoryId: z.string().min(1),
  timestamp: z.string().datetime(),
  type: eventTypeSchema,
  sessionId: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const collisionReasonSchema = z.object({
  code: z.enum([
    "same_file",
    "same_symbol",
    "path_overlap",
    "same_package",
    "dependency_edge",
    "recent_writes",
  ]),
  score: z.number().int().nonnegative(),
  detail: z.string().min(1),
});

export const collisionSchema = z.object({
  id: z.string().min(1),
  sessionA: z.string().min(1),
  sessionB: z.string().min(1),
  score: z.number().int().min(0).max(100),
  risk: z.enum(["clear", "awareness", "warning", "critical"]),
  reasons: z.array(collisionReasonSchema),
  openedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
});
export type Collision = z.infer<typeof collisionSchema>;

