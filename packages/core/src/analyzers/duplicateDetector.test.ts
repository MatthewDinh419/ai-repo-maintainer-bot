import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../config.js";
import type { GitHubClient, IssueSummary, RepoRef } from "../github/client.js";
import type { LLMClient } from "../llm/client.js";
import { runDuplicateDetection } from "./duplicateDetector.js";
import type { DuplicateResult } from "../llm/prompts/duplicate.js";

const ref: RepoRef = { owner: "acme", repo: "widgets" };

function makeIssue(overrides: Partial<IssueSummary> = {}): IssueSummary {
  return {
    number: 1,
    title: "Something broke",
    body: "It does not work",
    createdAt: new Date().toISOString(),
    labels: [],
    ...overrides,
  };
}

/**
 * Builds a minimal fake GitHubClient. Only the three methods used by the
 * duplicate detector are stubbed; the rest are left unimplemented.
 */
function makeGh(opts: {
  issue: IssueSummary;
  candidates: IssueSummary[];
}): GitHubClient {
  return {
    getIssue: vi.fn().mockResolvedValue(opts.issue),
    listRecentOpenIssues: vi.fn().mockResolvedValue(opts.candidates),
  } as unknown as GitHubClient;
}

/** Builds a fake LLMClient where `callStructured` returns a fixed duplicate result. */
function makeLlm(result: DuplicateResult): LLMClient {
  return {
    callStructured: vi.fn().mockResolvedValue(result),
  } as unknown as LLMClient;
}

describe("runDuplicateDetection", () => {
  it("skips when disabled in config", async () => {
    const config = parseConfig("duplicate_detection:\n  enabled: false\n");
    const gh = makeGh({ issue: makeIssue(), candidates: [] });
    const llm = makeLlm({
      is_duplicate: false,
      confidence: 0,
      matching_issue_number: null,
      explanation: "",
    });

    const out = await runDuplicateDetection({
      config,
      gh,
      llm,
      ref,
      issueNumber: 1,
    });

    expect(out.skipped).toBe("disabled");
    expect(out.flagged).toBe(false);
    // LLM should not be invoked when feature is disabled
    expect(llm.callStructured).not.toHaveBeenCalled();
    expect(gh.getIssue).not.toHaveBeenCalled();
  });

  it("skips when there are no candidate issues", async () => {
    const config = parseConfig(undefined);
    const gh = makeGh({ issue: makeIssue({ number: 5 }), candidates: [] });
    const llm = makeLlm({
      is_duplicate: false,
      confidence: 0,
      matching_issue_number: null,
      explanation: "",
    });

    const out = await runDuplicateDetection({
      config,
      gh,
      llm,
      ref,
      issueNumber: 5,
    });

    expect(out.skipped).toBe("no_candidates");
    expect(out.flagged).toBe(false);
    expect(llm.callStructured).not.toHaveBeenCalled();
  });

  it("does not flag when the LLM confidence is below the threshold", async () => {
    const config = parseConfig("duplicate_detection:\n  threshold: 0.9\n");
    const gh = makeGh({
      issue: makeIssue({ number: 10 }),
      candidates: [makeIssue({ number: 4, title: "Prior report" })],
    });
    const llm = makeLlm({
      is_duplicate: true,
      confidence: 0.7,
      matching_issue_number: 4,
      explanation: "Looks related",
    });

    const out = await runDuplicateDetection({
      config,
      gh,
      llm,
      ref,
      issueNumber: 10,
    });

    expect(out.flagged).toBe(false);
    expect(out.comment).toBeUndefined();
    expect(out.result?.matching_issue_number).toBe(4);
  });

  it("flags when confidence meets the threshold and embeds matched title", async () => {
    const config = parseConfig("duplicate_detection:\n  threshold: 0.8\n");
    const gh = makeGh({
      issue: makeIssue({ number: 11 }),
      candidates: [
        makeIssue({ number: 4, title: "Button broken on mobile" }),
        makeIssue({ number: 7, title: "Something else" }),
      ],
    });
    const llm = makeLlm({
      is_duplicate: true,
      confidence: 0.92,
      matching_issue_number: 4,
      explanation: "Same root cause.",
    });

    const out = await runDuplicateDetection({
      config,
      gh,
      llm,
      ref,
      issueNumber: 11,
    });

    expect(out.flagged).toBe(true);
    expect(out.label).toBe("possible-duplicate");
    expect(out.comment).toContain("#4");
    expect(out.comment).toContain("Button broken on mobile");
    expect(out.comment).toContain("92%");
    expect(out.comment).toContain("Same root cause.");
  });

  it("does not flag when is_duplicate is false even at high confidence", async () => {
    const config = parseConfig(undefined);
    const gh = makeGh({
      issue: makeIssue({ number: 20 }),
      candidates: [makeIssue({ number: 19 })],
    });
    const llm = makeLlm({
      is_duplicate: false,
      confidence: 0.99,
      matching_issue_number: null,
      explanation: "Different bug",
    });

    const out = await runDuplicateDetection({
      config,
      gh,
      llm,
      ref,
      issueNumber: 20,
    });

    expect(out.flagged).toBe(false);
    expect(out.comment).toBeUndefined();
  });

  it("passes the current issue's number as excludeNumber when fetching candidates", async () => {
    const config = parseConfig(undefined);
    const gh = makeGh({
      issue: makeIssue({ number: 42 }),
      candidates: [makeIssue({ number: 41 })],
    });
    const llm = makeLlm({
      is_duplicate: false,
      confidence: 0,
      matching_issue_number: null,
      explanation: "",
    });

    await runDuplicateDetection({ config, gh, llm, ref, issueNumber: 42 });

    expect(gh.listRecentOpenIssues).toHaveBeenCalledWith(
      ref,
      expect.objectContaining({ excludeNumber: 42 }),
    );
  });
});
