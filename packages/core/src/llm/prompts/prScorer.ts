import { UNTRUSTED_INPUT_NOTICE, wrapUntrusted } from "./shared.js";

export interface PrScorerPromptInput {
  title: string;
  body: string;
  changedFiles: Array<{ filename: string; additions: number; deletions: number }>;
}

export const PR_SCORER_SYSTEM = `You are a pull-request quality reviewer. You will see a PR title, description, and list of changed files. Assess only the "description" and "scope" dimensions; "tests", "sensitive paths", and "size" are handled by deterministic code elsewhere.

- description: Is the description meaningful — does it explain what and why?
- scope: Do the changed files plausibly match the description? Flag if unrelated files appear bundled in.

Be brief. Do not invent file contents.

${UNTRUSTED_INPUT_NOTICE}`;

export const PR_SCORER_TOOL_NAME = "report_pr_quality";
export const PR_SCORER_TOOL_DESCRIPTION =
  "Report the quality assessment for the description and scope dimensions.";

export const PR_SCORER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    description: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "warn", "flag"] },
        note: { type: "string" },
      },
      required: ["status", "note"],
      additionalProperties: false,
    },
    scope: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "warn", "flag"] },
        note: { type: "string" },
      },
      required: ["status", "note"],
      additionalProperties: false,
    },
  },
  required: ["description", "scope"],
  additionalProperties: false,
} as const;

export interface PrScorerResult {
  description: { status: "ok" | "warn" | "flag"; note: string };
  scope: { status: "ok" | "warn" | "flag"; note: string };
}

export function buildPrScorerUserMessage(input: PrScorerPromptInput): string {
  const files = input.changedFiles
    .map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join("\n");
  return [
    "Pull request:",
    wrapUntrusted(
      "pr",
      `Title: ${input.title}\n\nDescription:\n${input.body || "(empty)"}`,
    ),
    "",
    `Changed files (${input.changedFiles.length}):`,
    wrapUntrusted("files", files || "(none)"),
    "",
    "Call report_pr_quality with your assessment.",
  ].join("\n");
}
