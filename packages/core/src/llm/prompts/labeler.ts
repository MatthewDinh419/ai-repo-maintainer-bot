import { UNTRUSTED_INPUT_NOTICE, wrapUntrusted } from "./shared.js";

export interface LabelerPromptInput {
  kind: "issue" | "pull_request";
  title: string;
  body: string;
  labelDefinitions: Record<string, string>;
}

export const LABELER_SYSTEM = `You are a GitHub triage assistant. You will be given a GitHub issue or pull request and a set of labels with plain-English descriptions. Select the labels that apply based on the description, not the label name. Pick only labels that clearly apply; it is fine to return zero. Provide a short justification for each selected label.

${UNTRUSTED_INPUT_NOTICE}`;

export const LABELER_TOOL_NAME = "apply_labels";
export const LABELER_TOOL_DESCRIPTION =
  "Return the set of labels that apply to the given issue or PR.";

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

export interface LabelerResult {
  labels: Array<{ name: string; justification: string }>;
}

export function buildLabelerUserMessage(input: LabelerPromptInput): string {
  const defs = Object.entries(input.labelDefinitions)
    .map(([name, desc]) => `- ${name}: ${desc}`)
    .join("\n");
  return [
    `Available labels (name: description):\n${defs}`,
    "",
    `${input.kind === "issue" ? "Issue" : "Pull request"} content:`,
    wrapUntrusted("content", `Title: ${input.title}\n\n${input.body}`),
    "",
    "Call apply_labels with the labels that apply. Only use label names from the list above.",
  ].join("\n");
}
