import { UNTRUSTED_INPUT_NOTICE, wrapUntrusted } from "./shared.js";

/**
 * Inputs for the labeler: item kind, text, and name -> description map.
 */
export interface LabelerPromptInput {
  kind: "issue" | "pull_request";
  title: string;
  body: string;
  labelDefinitions: Record<string, string>;
}

/** System prompt: pick only applicable labels; untrusted input notice. */
export const LABELER_SYSTEM = `You are a GitHub triage assistant. You will be given a GitHub issue or pull request and a set of labels with plain-English descriptions. Select the labels that apply based on the description, not the label name. Pick only labels that clearly apply; it is fine to return zero. Provide a short justification for each selected label.

${UNTRUSTED_INPUT_NOTICE}`;

export const LABELER_TOOL_NAME = "apply_labels";
/** Tool description for the label-selection tool. */
export const LABELER_TOOL_DESCRIPTION =
  "Return the set of labels that apply to the given issue or PR.";

/** JSON schema: array of { name, justification }. */
export const LABELER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          justification: { type: "string" },
        },
        required: ["name", "justification"],
        additionalProperties: false,
      },
    },
  },
  required: ["labels"],
  additionalProperties: false,
} as const;

/** Model output: zero or more labels, each with a one-line reason. */
export interface LabelerResult {
  labels: Array<{ name: string; justification: string }>;
}

/**
 * Lists allowed labels, embeds the issue/PR body in `<untrusted>`, and asks
 * for a tool call with chosen names and short justifications.
 */
export function buildLabelerUserMessage(input: LabelerPromptInput): string {
  const defs = Object.entries(input.labelDefinitions)
    .map(([name, desc]) => `- ${name}: ${desc}`)
    .join("\n");
  const kindLabel = input.kind === "issue" ? "Issue" : "Pull request";
  return `Available labels (name: description):
${defs}

${kindLabel} content:
${wrapUntrusted("content", `Title: ${input.title}\n\n${input.body}`)}

Call apply_labels with the labels that apply. Only use label names from the list above.`;
}
