export interface ActivitySnapshot {
  files: string[];
  scopes: string[];
  symbols: string[];
}

export interface CollisionReason {
  code: "same_file" | "same_symbol" | "path_overlap";
  score: number;
  detail: string;
}

export interface CollisionEvaluation {
  score: number;
  risk: "clear" | "awareness" | "warning" | "critical";
  reasons: CollisionReason[];
}

const normalize = (value: string): string =>
  value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");

const overlaps = (left: string, right: string): boolean => {
  const a = normalize(left).replace(/\/\*\*$/, "");
  const b = normalize(right).replace(/\/\*\*$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
};

const intersection = (left: string[], right: string[]): string[] => {
  const rightSet = new Set(right.map(normalize));
  return [...new Set(left.map(normalize).filter((value) => rightSet.has(value)))];
};

export function evaluateCollision(
  a: ActivitySnapshot,
  b: ActivitySnapshot,
): CollisionEvaluation {
  const reasons: CollisionReason[] = [];
  const sameFiles = intersection(a.files, b.files);
  const sameSymbols = intersection(a.symbols, b.symbols);

  if (sameFiles.length > 0) {
    reasons.push({
      code: "same_file",
      score: 70,
      detail: `Both sessions are modifying ${sameFiles.join(", ")}`,
    });
  }

  if (sameSymbols.length > 0) {
    reasons.push({
      code: "same_symbol",
      score: 100,
      detail: `Both sessions claim ${sameSymbols.join(", ")}`,
    });
  }

  const scopeOverlap = a.scopes.some((left) =>
    b.scopes.some((right) => overlaps(left, right)),
  );
  if (scopeOverlap && sameFiles.length === 0) {
    reasons.push({
      code: "path_overlap",
      score: 30,
      detail: "Declared or observed path scopes overlap",
    });
  }

  const score = Math.min(
    100,
    reasons.reduce((total, reason) => total + reason.score, 0),
  );
  const risk =
    score >= 90
      ? "critical"
      : score >= 60
        ? "warning"
        : score >= 30
          ? "awareness"
          : "clear";

  return { score, risk, reasons };
}

