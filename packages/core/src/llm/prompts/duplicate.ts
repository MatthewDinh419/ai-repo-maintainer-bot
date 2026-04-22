import { UNTRUSTED_INPUT_NOTICE, wrapUntrusted } from "./shared.js";
import type { IssueSummary } from "../../github/client.js";

/**
 * Inputs for the duplicate-finder user message: the new issue and a list of
 * candidate open issues.
 */
export interface DuplicatePromptInput {
  newIssue: { title: string; body: string };
  candidates: IssueSummary[];
}

/** System prompt: conservative duplicate detection; untrusted input notice. */
export const DUPLICATE_SYSTEM = `You are a GitHub issue triage assistant. Your task is to decide whether a new issue is likely a duplicate of any existing open issue in a given list. Be conservative: only flag duplicates when the underlying bug or feature is clearly the same, not merely when topics overlap.

${UNTRUSTED_INPUT_NOTICE}`;

export const DUPLICATE_TOOL_NAME = "report_duplicate_check";
/** Anthropic tool description string for the duplicate-check tool. */
export const DUPLICATE_TOOL_DESCRIPTION =
  "Report the result of the duplicate detection analysis.";

/** JSON schema for the structured duplicate decision tool. */
export const DUPLICATE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    is_duplicate: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    matching_issue_number: { type: ["integer", "null"] },
    explanation: { type: "string" },
  },
  required: ["is_duplicate", "confidence", "matching_issue_number", "explanation"],
  additionalProperties: false,
} as const;

/** Parsed tool output: duplicate? confidence, which issue, and short rationale. */
export interface DuplicateResult {
  is_duplicate: boolean;
  confidence: number;
  matching_issue_number: number | null;
  explanation: string;
}

/**
 * Builds the user turn: new issue and candidates as JSON, each wrapped in
 * `<untrusted>` for prompt-injection hardening.
 */
export function buildDuplicateUserMessage(input: DuplicatePromptInput): string {
  const candidates = input.candidates.map((c) => ({
    number: c.number,
    title: c.title,
    body: c.body,
  }));
  return [
    "New issue:",
    wrapUntrusted(
      "new_issue",
      `Title: ${input.newIssue.title}\nBody: ${input.newIssue.body}`,
    ),
    "",
    "Existing open issues (most recent first, JSON):",
    wrapUntrusted("existing_issues", JSON.stringify(candidates, null, 2)),
    "",
    "Call report_duplicate_check with your decision.",
  ].join("\n");
}
