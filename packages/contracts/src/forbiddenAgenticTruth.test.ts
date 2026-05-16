import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";

const packagesRoot = path.resolve(import.meta.dirname, "../..");
const scanRoots = [
  path.join(packagesRoot, "contracts/src"),
  path.join(packagesRoot, "orchestration-core/src"),
] as const;

const literalTruthDeclarationPatterns = [
  {
    category: "program status literal truth",
    pattern:
      /\b(?:export\s+)?(?:const|type)\s+\w*Program\w*Status\w*\s*=\s*(?:Schema\.Literal[s]?\(|\[[\s\S]{0,400}["'][^"']+["']|new\s+Set\s*\(|(?!typeof\b)[^;]*["'][^"']+["'][^;]*;)/m,
  },
  {
    category: "todo status or priority literal truth",
    pattern:
      /\b(?:export\s+)?(?:const|type)\s+\w*Todo\w*(?:Status|Priority)\w*\s*=\s*(?:Schema\.Literal[s]?\(|\[[\s\S]{0,400}["'][^"']+["']|new\s+Set\s*\(|(?!typeof\b)[^;]*["'][^"']+["'][^;]*;)/m,
  },
  {
    category: "notification severity, kind, state, or tone literal truth",
    pattern:
      /\b(?:export\s+)?(?:const|type)\s+\w*Notification\w*(?:Severity|Kind|State|Tone)\w*\s*=\s*(?:Schema\.Literal[s]?\(|\[[\s\S]{0,400}["'][^"']+["']|new\s+Set\s*\(|(?!typeof\b)[^;]*["'][^"']+["'][^;]*;)/m,
  },
  {
    category: "attention state, kind, category, or severity literal truth",
    pattern:
      /\b(?:export\s+)?(?:const|type)\s+\w*Attention\w*(?:State|Kind|Category|Severity)\w*\s*=\s*(?:Schema\.Literal[s]?\(|\[[\s\S]{0,400}["'][^"']+["']|new\s+Set\s*\(|(?!typeof\b)[^;]*["'][^"']+["'][^;]*;)/m,
  },
  {
    category: "wake outcome, state, consume-reason, or display semantic literal truth",
    pattern:
      /\b(?:export\s+)?(?:const|type)\s+\w*Wake\w*(?:Outcome|State|ConsumeReason|Display|Semantic)\w*\s*=\s*(?:Schema\.Literal[s]?\(|\[[\s\S]{0,400}["'][^"']+["']|new\s+Set\s*\(|(?!typeof\b)[^;]*["'][^"']+["'][^;]*;)/m,
  },
];

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath);
    }
    if (!entry.isFile()) {
      return [];
    }
    if (!fullPath.endsWith(".ts") || fullPath.endsWith(".test.ts")) {
      return [];
    }
    return [fullPath];
  });
}

function relativeToPackagesRoot(filePath: string): string {
  return path.relative(packagesRoot, filePath);
}

describe("forbidden agentic truth sources", () => {
  it("does not reintroduce local semantic literal truth or command-truth ownership", () => {
    const violations = scanRoots.flatMap((root) =>
      listSourceFiles(root).flatMap((filePath) => {
        const source = fs.readFileSync(filePath, "utf8");
        const relativePath = relativeToPackagesRoot(filePath);
        const fileViolations: Array<{ category: string; relativePath: string }> = [];

        for (const { category, pattern } of literalTruthDeclarationPatterns) {
          if (pattern.test(source)) {
            fileViolations.push({ category, relativePath });
          }
        }
        const localOwnerCommandTruth =
          /["']t3code-[a-z0-9-]+["']/.test(source) ||
          /\bexport\s+enum\s+\w*(?:Owner)?Command\w*\b/.test(source) ||
          /\b(?:export\s+)?type\s+\w*(?:Owner)?Command\w*\s*=\s*(?!typeof\b)[^;]*["']t3code-[^"']+["'][^;]*;/m.test(
            source,
          );

        if (localOwnerCommandTruth) {
          fileViolations.push({
            category: "owner command-name literal unions or exported command enums",
            relativePath,
          });
        }

        return fileViolations;
      }),
    );

    assert.deepStrictEqual(violations, []);
  });
});
