import { describe, expect, it } from "vitest";
import { eventEnvelopeSchema, protocolVersion } from "./index.js";

describe("eventEnvelopeSchema", () => {
  it("accepts an allowlisted metadata event", () => {
    const result = eventEnvelopeSchema.safeParse({
      protocolVersion,
      id: "evt_1",
      sequence: 1,
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
      timestamp: "2026-09-17T10:42:14.283Z",
      type: "file.write",
      sessionId: "session_1",
      payload: { path: "src/rank.ts", branch: "feature/rank" },
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown event types", () => {
    const result = eventEnvelopeSchema.safeParse({
      protocolVersion,
      id: "evt_1",
      sequence: 1,
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
      timestamp: "2026-09-17T10:42:14.283Z",
      type: "source.uploaded",
      payload: {},
    });

    expect(result.success).toBe(false);
  });
});

