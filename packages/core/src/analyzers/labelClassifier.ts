import type { Config } from "../config.js";
import type { GitHubClient, RepoRef } from "../github/client.js";
import type { LLMClient } from "../llm/client.js";
import {
  LABELER_SYSTEM,
  LABELER_TOOL_DESCRIPTION,
  LABELER_TOOL_NAME,
  LABELER_TOOL_SCHEMA,
  buildLabelerUserMessage,
  type LabelerResult,
} from "../llm/prompts/labeler.js";

export interface LabelAnalysis {
  skipped?: "disabled";
  labels: Array<{ name: string; justification: string }>;
  appliedLabels: string[];
}

export async function runLabelClassification(deps: {
  config: Config;
  gh: GitHubClient;
  llm: LLMClient;
  ref: RepoRef;
  kind: "issue" | "pull_request";
  number: number;
  title: string;
  body: string;
}): Promise<LabelAnalysis> {
  const cfg = deps.config.labeling;
  if (!cfg.enabled) return { skipped: "disabled", labels: [], appliedLabels: [] };

  const result = await deps.llm.callStructured<LabelerResult>({
    system: LABELER_SYSTEM,
    user: buildLabelerUserMessage({
      kind: deps.kind,
      title: deps.title,
      body: deps.body,
      labelDefinitions: cfg.labels,
    }),
    toolName: LABELER_TOOL_NAME,
    toolDescription: LABELER_TOOL_DESCRIPTION,
    inputSchema: LABELER_TOOL_SCHEMA as unknown as Record<string, unknown>,
    parse: (raw) => raw as LabelerResult,
  });

  const allowed = new Set(Object.keys(cfg.labels));
  const matches = result.labels.filter((l) => allowed.has(l.name));

  return {
    labels: matches,
    appliedLabels: matches.map((m) => m.name),
  };
}
