import type { Config } from "../config.js";
import type { GitHubClient, RepoRef } from "../github/client.js";
import type { LLMClient } from "../llm/client.js";
import {
  DUPLICATE_SYSTEM,
  DUPLICATE_TOOL_DESCRIPTION,
  DUPLICATE_TOOL_NAME,
  DUPLICATE_TOOL_SCHEMA,
  buildDuplicateUserMessage,
  type DuplicateResult,
} from "../llm/prompts/duplicate.js";
import { parseDuration } from "../config.js";

export interface DuplicateAnalysis {
  skipped?: "disabled" | "no_candidates";
  result?: DuplicateResult;
  flagged: boolean;
  comment?: string;
  label?: string;
}

export async function runDuplicateDetection(deps: {
  config: Config;
  gh: GitHubClient;
  llm: LLMClient;
  ref: RepoRef;
  issueNumber: number;
}): Promise<DuplicateAnalysis> {
  const cfg = deps.config.duplicate_detection;
  if (!cfg.enabled) return { flagged: false, skipped: "disabled" };

  const issue = await deps.gh.getIssue(deps.ref, deps.issueNumber);
  const since = new Date(Date.now() - parseDuration(cfg.search_window));
  const candidates = await deps.gh.listRecentOpenIssues(deps.ref, {
    since,
    limit: cfg.max_candidates,
    excludeNumber: issue.number,
  });
  if (candidates.length === 0) return { flagged: false, skipped: "no_candidates" };

  const result = await deps.llm.callStructured<DuplicateResult>({
    system: DUPLICATE_SYSTEM,
    user: buildDuplicateUserMessage({
      newIssue: { title: issue.title, body: issue.body },
      candidates,
    }),
    toolName: DUPLICATE_TOOL_NAME,
    toolDescription: DUPLICATE_TOOL_DESCRIPTION,
    inputSchema: DUPLICATE_TOOL_SCHEMA as unknown as Record<string, unknown>,
    parse: (raw) => raw as DuplicateResult,
  });

  const flagged =
    result.is_duplicate &&
    result.confidence >= cfg.threshold &&
    typeof result.matching_issue_number === "number";
  if (!flagged) return { flagged: false, result };

  const confidencePct = Math.round(result.confidence * 100);
  const matched = candidates.find((c) => c.number === result.matching_issue_number);
  const matchTitle = matched ? ` ("${matched.title}")` : "";
  const comment = [
    `This looks similar to #${result.matching_issue_number}${matchTitle}.`,
    "",
    "Is that the same issue? If so, a maintainer may mark this as a duplicate.",
    "If it's different, please add more detail about how your case differs.",
    "",
    `${result.explanation}`,
    "",
    `<sub>Posted by ai-repo-maintainer-bot · confidence: ${confidencePct}%</sub>`,
  ].join("\n");

  return {
    flagged: true,
    result,
    comment,
    label: "possible-duplicate",
  };
}
