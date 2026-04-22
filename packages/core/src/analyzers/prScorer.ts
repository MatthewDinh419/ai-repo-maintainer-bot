import type { Config } from "../config.js";
import type { GitHubClient, PullFileChange, PullSummary, RepoRef } from "../github/client.js";
import type { LLMClient } from "../llm/client.js";
import {
  PR_SCORER_SYSTEM,
  PR_SCORER_TOOL_DESCRIPTION,
  PR_SCORER_TOOL_NAME,
  PR_SCORER_TOOL_SCHEMA,
  buildPrScorerUserMessage,
  type PrScorerResult,
} from "../llm/prompts/prScorer.js";

export type CheckStatus = "ok" | "warn" | "flag";

export interface DimensionResult {
  status: CheckStatus;
  note: string;
}

export interface PrScoreReport {
  description: DimensionResult;
  scope: DimensionResult;
  tests: DimensionResult;
  sensitivePaths: DimensionResult;
  size: DimensionResult;
}

export interface PrScoreAnalysis {
  skipped?: "disabled";
  report?: PrScoreReport;
  comment?: string;
}

export async function runPrScoring(deps: {
  config: Config;
  gh: GitHubClient;
  llm: LLMClient;
  ref: RepoRef;
  pullNumber: number;
}): Promise<PrScoreAnalysis> {
  const cfg = deps.config.pr_scoring;
  if (!cfg.enabled) return { skipped: "disabled" };

  const pr = await deps.gh.getPull(deps.ref, deps.pullNumber);
  const files = await deps.gh.listPullFiles(deps.ref, deps.pullNumber);

  const tests = evaluateTests(files, cfg.require_tests_for_paths);
  const sensitivePaths = evaluateSensitivePaths(files, cfg.sensitive_paths);
  const size = evaluateSize(pr, cfg.large_pr_threshold);

  const llmResult = await deps.llm.callStructured<PrScorerResult>({
    system: PR_SCORER_SYSTEM,
    user: buildPrScorerUserMessage({
      title: pr.title,
      body: pr.body,
      changedFiles: files.map((f) => ({
        filename: f.filename,
        additions: f.additions,
        deletions: f.deletions,
      })),
    }),
    toolName: PR_SCORER_TOOL_NAME,
    toolDescription: PR_SCORER_TOOL_DESCRIPTION,
    inputSchema: PR_SCORER_TOOL_SCHEMA as unknown as Record<string, unknown>,
    parse: (raw) => raw as PrScorerResult,
  });

  const descriptionFromRules = evaluateDescriptionMinLength(
    pr.body,
    cfg.require_description_min_chars,
  );
  const description =
    descriptionFromRules.status === "flag" ? descriptionFromRules : llmResult.description;

  const report: PrScoreReport = {
    description,
    scope: llmResult.scope,
    tests,
    sensitivePaths,
    size,
  };

  return { report, comment: renderComment(report) };
}

function evaluateDescriptionMinLength(body: string, min: number): DimensionResult {
  if (body.trim().length < min) {
    return {
      status: "flag",
      note: `description is under ${min} characters`,
    };
  }
  return { status: "ok", note: "" };
}

function evaluateTests(
  files: PullFileChange[],
  requirePaths: string[],
): DimensionResult {
  const changedUnderWatched = files.filter((f) =>
    requirePaths.some((p) => globLike(p, f.filename)),
  );
  if (changedUnderWatched.length === 0) return { status: "ok", note: "" };

  const hasTests = files.some((f) => /(^|\/)(test|tests|__tests__|spec)(\/|$)|\.test\.|\.spec\./.test(f.filename));
  if (hasTests) return { status: "ok", note: "" };

  const dirs = new Set(
    changedUnderWatched.map((f) => {
      const parts = f.filename.split("/");
      return parts.slice(0, Math.min(3, parts.length - 1)).join("/") || f.filename;
    }),
  );
  return {
    status: "warn",
    note: `no test files found for changes in ${[...dirs].join(", ")}`,
  };
}

function evaluateSensitivePaths(
  files: PullFileChange[],
  sensitive: string[],
): DimensionResult {
  if (sensitive.length === 0) return { status: "ok", note: "" };
  const hits = files.filter((f) => sensitive.some((p) => globLike(p, f.filename)));
  if (hits.length === 0) return { status: "ok", note: "" };
  return {
    status: "flag",
    note: `touches ${hits.map((h) => h.filename).join(", ")}`,
  };
}

function evaluateSize(pr: PullSummary, threshold: number): DimensionResult {
  const total = pr.additions + pr.deletions;
  if (total > threshold) {
    return {
      status: "warn",
      note: `${total} lines changed; consider splitting`,
    };
  }
  return { status: "ok", note: `${total} lines` };
}

function renderComment(r: PrScoreReport): string {
  const row = (name: string, d: DimensionResult): string => {
    const tag = d.status.toUpperCase();
    const result = d.note ? `${tag} — ${d.note}` : tag;
    return `| ${name.padEnd(15)} | ${result} |`;
  };
  return [
    "## PR quality check",
    "",
    "| Check           | Result |",
    "|-----------------|--------|",
    row("Description", r.description),
    row("Scope", r.scope),
    row("Tests", r.tests),
    row("Sensitive paths", r.sensitivePaths),
    row("Size", r.size),
    "",
    "<sub>Posted by ai-repo-maintainer-bot · not a verdict, just a signal</sub>",
  ].join("\n");
}

export function globLike(pattern: string, path: string): boolean {
  let regexStr = "^";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        regexStr += "(?:[^/]+/)*";
        i += 3;
      } else {
        regexStr += ".*";
        i += 2;
      }
    } else if (pattern[i] === "*") {
      regexStr += "[^/]*";
      i += 1;
    } else {
      const ch = pattern[i] as string;
      regexStr += /[.+^${}()|[\]\\]/.test(ch) ? "\\" + ch : ch;
      i += 1;
    }
  }
  regexStr += "$";
  return new RegExp(regexStr).test(path);
}
