import { describe, expect, it } from "vitest";
import { evaluateCollision } from "./index.js";

const empty = { files: [], scopes: [], symbols: [] };

describe("evaluateCollision", () => {
  it("marks exact-file overlap as a warning", () => {
    const result = evaluateCollision(
      { ...empty, files: ["src/products/types.ts"] },
      { ...empty, files: ["./src/products/types.ts"] },
    );

    expect(result.risk).toBe("warning");
    expect(result.reasons[0]?.code).toBe("same_file");
  });

  it("marks same-symbol work as critical", () => {
    const result = evaluateCollision(
      { ...empty, symbols: ["ProductRepresentation"] },
      { ...empty, symbols: ["ProductRepresentation"] },
    );

    expect(result).toMatchObject({ score: 100, risk: "critical" });
  });

  it("normalizes Windows paths and detects nested scopes", () => {
    const result = evaluateCollision(
      { ...empty, scopes: ["src\\recommendations\\**"] },
      { ...empty, scopes: ["src/recommendations/rank.ts"] },
    );

    expect(result).toMatchObject({ score: 30, risk: "awareness" });
  });

  it("stays clear for unrelated work", () => {
    const result = evaluateCollision(
      { ...empty, scopes: ["docs/**"] },
      { ...empty, scopes: ["src/engine/**"] },
    );

    expect(result).toEqual({ score: 0, risk: "clear", reasons: [] });
  });
});

