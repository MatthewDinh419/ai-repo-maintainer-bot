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

/** Per-check severity for the PR quality table. */
export type CheckStatus = "ok" | "warn" | "flag";

/** One row in the report: status plus a short human-readable note. */
export interface DimensionResult {
  status: CheckStatus;
  note: string;
}

/** All dimensions shown in the posted markdown table. */
export interface PrScoreReport {
  description: DimensionResult;
  scope: DimensionResult;
  tests: DimensionResult;
  sensitivePaths: DimensionResult;
  size: DimensionResult;
}

/** Result of PR scoring, including the rendered table body when not skipped. */
export interface PrScoreAnalysis {
  skipped?: "disabled";
  report?: PrScoreReport;
  comment?: string;
}

/**
 * Fetches the PR and files, runs deterministic checks (tests, paths, size) and
 * an LLM pass for description/scope, then merges rules with LLM output and
 * returns a markdown comment.
 *
 * @param deps.config - App configuration (`pr_scoring` section)
 * @param deps.gh - GitHub client
 * @param deps.llm - Structured LLM client
 * @param deps.ref - Target repository
 * @param deps.pullNumber - PR to score
 */
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

  // Deterministic checks: test presence, sensitive paths, diff size
  const tests = evaluateTests(files, cfg.require_tests_for_paths);
  const sensitivePaths = evaluateSensitivePaths(files, cfg.sensitive_paths);
  const size = evaluateSize(pr, cfg.large_pr_threshold);

  // LLM: description + scope only (other columns come from rules above)
  const diffLines = cfg.diff_lines_per_file;
  const llmResult = await deps.llm.callStructured<PrScorerResult>({
    system: PR_SCORER_SYSTEM,
    user: buildPrScorerUserMessage({
      title: pr.title,
      body: pr.body,
      changedFiles: files.map((f) => ({
        filename: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        patch: diffLines > 0 ? truncatePatch(f.patch, diffLines) : undefined,
      })),
    }),
    toolName: PR_SCORER_TOOL_NAME,
    toolDescription: PR_SCORER_TOOL_DESCRIPTION,
    inputSchema: PR_SCORER_TOOL_SCHEMA as unknown as Record<string, unknown>,
    parse: (raw) => raw as PrScorerResult,
  });

  // Minimum description length can override a lenient LLM "ok"
  const descriptionFromRules = evaluateDescriptionMinLength(
    pr.body,
    cfg.require_description_min_chars,
  );
  const description =
    descriptionFromRules.status === "flag" ? descriptionFromRules : llmResult.description;

  // Assemble the full report and the GitHub comment body
  const report: PrScoreReport = {
    description,
    scope: llmResult.scope,
    tests,
    sensitivePaths,
    size,
  };

  return { report, comment: renderComment(report) };
}

/**
 * Flags when the PR body is shorter than the configured minimum (trimmed).
 */
function evaluateDescriptionMinLength(body: string, min: number): DimensionResult {
  if (body.trim().length < min) {
    return {
      status: "flag",
      note: `description is under ${min} characters`,
    };
  }
  return { status: "ok", note: "" };
}

/**
 * If watched paths change, require at least one file that looks like a test;
 * otherwise warn (not flag).
 */
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

/**
 * Flags any change touching a configured sensitive path glob.
 */
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

/**
 * Warns when total additions+deletions exceed the large-PR threshold.
 */
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

/** Renders the markdown table posted as a PR comment. */
function renderComment(r: PrScoreReport): string {
  const row = (name: string, d: DimensionResult): string => {
    const tag = d.status.toUpperCase();
    const result = d.note ? `${tag} — ${d.note}` : tag;
    return `| ${name.padEnd(15)} | ${result} |`;
  };
  return `## PR quality check

| Check           | Result |
|-----------------|--------|
${row("Description", r.description)}
${row("Scope", r.scope)}
${row("Tests", r.tests)}
${row("Sensitive paths", r.sensitivePaths)}
${row("Size", r.size)}

<sub>Posted by ai-repo-maintainer-bot · not a verdict, just a signal</sub>`;
}

/**
 * Truncates a patch to the first `maxLines` lines, appending a note if cut.
 */
function truncatePatch(patch: string | undefined, maxLines: number): string | undefined {
  if (!patch) return undefined;
  const lines = patch.split("\n");
  if (lines.length <= maxLines) return patch;
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
}

/**
 * Glob-like match for path patterns: `*` = segment, `**/` = nested dirs.
 * Used for `require_tests_for_paths` and `sensitive_paths` config.
 */
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
