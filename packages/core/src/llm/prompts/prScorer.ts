import { UNTRUSTED_INPUT_NOTICE, wrapUntrusted } from "./shared.js";

/**
 * What the PR scorer LLM sees: title, body, and per-file change stats.
 */
export interface PrScorerPromptInput {
  title: string;
  body: string;
  changedFiles: Array<{ filename: string; additions: number; deletions: number }>;
}

/** System prompt: only description and scope; other dimensions are local rules. */
export const PR_SCORER_SYSTEM = `You are a pull-request quality reviewer. You will see a PR title, description, and list of changed files. Assess only the "description" and "scope" dimensions; "tests", "sensitive paths", and "size" are handled by deterministic code elsewhere.

- description: Is the description meaningful — does it explain what and why?
- scope: Do the changed files plausibly match the description? Flag if unrelated files appear bundled in.

Be brief. Do not invent file contents.

${UNTRUSTED_INPUT_NOTICE}`;

export const PR_SCORER_TOOL_NAME = "report_pr_quality";
/** Tool blurb: description and scope only. */
export const PR_SCORER_TOOL_DESCRIPTION =
  "Report the quality assessment for the description and scope dimensions.";

/** JSON schema: nested description + scope objects with status and note. */
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

/** LLM output for the two model-assessed dimensions. */
export interface PrScorerResult {
  description: { status: "ok" | "warn" | "flag"; note: string };
  scope: { status: "ok" | "warn" | "flag"; note: string };
}

/**
 * Embeds title/body and file list in `<untrusted>` and requests the quality tool.
 */
export function buildPrScorerUserMessage(input: PrScorerPromptInput): string {
  const files = input.changedFiles
    .map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join("\n");
  return `Pull request:
${wrapUntrusted(
  "pr",
  `Title: ${input.title}\n\nDescription:\n${input.body || "(empty)"}`,
)}

Changed files (${input.changedFiles.length}):
${wrapUntrusted("files", files || "(none)")}

Call report_pr_quality with your assessment.`;
}
