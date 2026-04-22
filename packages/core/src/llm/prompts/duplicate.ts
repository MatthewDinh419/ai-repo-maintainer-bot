import { UNTRUSTED_INPUT_NOTICE, wrapUntrusted } from "./shared.js";
import type { IssueSummary } from "../../github/client.js";

export interface DuplicatePromptInput {
  newIssue: { title: string; body: string };
  candidates: IssueSummary[];
}

export const DUPLICATE_SYSTEM = `You are a GitHub issue triage assistant. Your task is to decide whether a new issue is likely a duplicate of any existing open issue in a given list. Be conservative: only flag duplicates when the underlying bug or feature is clearly the same, not merely when topics overlap.

${UNTRUSTED_INPUT_NOTICE}`;

export const DUPLICATE_TOOL_NAME = "report_duplicate_check";
export const DUPLICATE_TOOL_DESCRIPTION =
  "Report the result of the duplicate detection analysis.";

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

export interface DuplicateResult {
  is_duplicate: boolean;
  confidence: number;
  matching_issue_number: number | null;
  explanation: string;
}

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
