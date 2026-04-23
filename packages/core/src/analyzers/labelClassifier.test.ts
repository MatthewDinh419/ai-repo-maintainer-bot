import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../config.js";
import type { GitHubClient, RepoRef } from "../github/client.js";
import type { LLMClient } from "../llm/client.js";
import { runLabelClassification } from "./labelClassifier.js";
import type { LabelerResult } from "../llm/prompts/labeler.js";

const ref: RepoRef = { owner: "acme", repo: "widgets" };

/** A GH client stub — label classifier does not hit GitHub, so we pass {}. */
const gh = {} as unknown as GitHubClient;

/** Builds a fake LLMClient that returns a canned labeler result. */
function makeLlm(result: LabelerResult): LLMClient {
  return {
    callStructured: vi.fn().mockResolvedValue(result),
  } as unknown as LLMClient;
}

describe("runLabelClassification", () => {
  it("skips when disabled", async () => {
    const config = parseConfig("labeling:\n  enabled: false\n");
    const llm = makeLlm({ labels: [] });

    const out = await runLabelClassification({
      config,
      gh,
      llm,
      ref,
      kind: "issue",
      number: 1,
      title: "t",
      body: "b",
    });

    expect(out.skipped).toBe("disabled");
    expect(out.appliedLabels).toEqual([]);
    expect(llm.callStructured).not.toHaveBeenCalled();
  });

  it("returns labels the LLM picked when they are in the allowed map", async () => {
    const config = parseConfig(undefined); // defaults include bug, feature, docs, etc.
    const llm = makeLlm({
      labels: [
        { name: "bug", justification: "error messages" },
        { name: "docs", justification: "mentions README" },
      ],
    });

    const out = await runLabelClassification({
      config,
      gh,
      llm,
      ref,
      kind: "issue",
      number: 1,
      title: "Crash on startup",
      body: "App crashes and the README is wrong",
    });

    expect(out.appliedLabels).toEqual(["bug", "docs"]);
    expect(out.labels).toHaveLength(2);
    expect(out.labels[0]?.justification).toBe("error messages");
  });

  it("drops LLM-suggested labels that are not in the config allowlist", async () => {
    const config = parseConfig(
      "labeling:\n  labels:\n    bug: something broken\n    feature: new functionality\n",
    );
    const llm = makeLlm({
      labels: [
        { name: "bug", justification: "ok" },
        { name: "hallucinated-label", justification: "model made this up" },
        { name: "feature", justification: "ok" },
      ],
    });

    const out = await runLabelClassification({
      config,
      gh,
      llm,
      ref,
      kind: "pull_request",
      number: 2,
      title: "x",
      body: "y",
    });

    expect(out.appliedLabels).toEqual(["bug", "feature"]);
    expect(out.appliedLabels).not.toContain("hallucinated-label");
  });

  it("returns empty applied list when LLM returns no labels", async () => {
    const config = parseConfig(undefined);
    const llm = makeLlm({ labels: [] });

    const out = await runLabelClassification({
      config,
      gh,
      llm,
      ref,
      kind: "issue",
      number: 1,
      title: "greet",
      body: "hi",
    });

    expect(out.appliedLabels).toEqual([]);
    expect(out.labels).toEqual([]);
  });
});
