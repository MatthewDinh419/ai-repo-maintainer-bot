import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../config.js";
import type {
  GitHubClient,
  PullFileChange,
  PullSummary,
  RepoRef,
} from "../github/client.js";
import type { LLMClient } from "../llm/client.js";
import type { PrScorerResult } from "../llm/prompts/prScorer.js";
import { globLike, runPrScoring } from "./prScorer.js";

describe("globLike", () => {
  it("matches single-segment wildcards", () => {
    expect(globLike("src/*.ts", "src/foo.ts")).toBe(true);
    expect(globLike("src/*.ts", "src/sub/foo.ts")).toBe(false);
  });

  it("matches recursive wildcards", () => {
    expect(globLike("src/**", "src/a/b/c.ts")).toBe(true);
    expect(globLike("src/**/auth/**", "src/a/auth/b.ts")).toBe(true);
    expect(globLike("src/**/auth/**", "src/auth/b.ts")).toBe(true);
    expect(globLike("src/**/auth/**", "lib/auth/b.ts")).toBe(false);
  });

  it("escapes regex metacharacters in path", () => {
    expect(globLike("src/a.b/*", "src/a.b/foo")).toBe(true);
    expect(globLike("src/a.b/*", "src/axb/foo")).toBe(false);
  });
});

const ref: RepoRef = { owner: "acme", repo: "widgets" };

function makePr(overrides: Partial<PullSummary> = {}): PullSummary {
  return {
    number: 1,
    title: "Add greeting helper",
    body: "This PR adds a greeting helper with tests and docs.",
    draft: false,
    additions: 10,
    deletions: 2,
    changedFiles: 2,
    author: "dev",
    fromFork: false,
    ...overrides,
  };
}

function makeFile(overrides: Partial<PullFileChange> = {}): PullFileChange {
  return {
    filename: "packages/core/src/hello.ts",
    status: "modified",
    additions: 5,
    deletions: 1,
    patch: undefined,
    ...overrides,
  };
}

function makeGh(opts: { pr: PullSummary; files: PullFileChange[] }): GitHubClient {
  return {
    getPull: vi.fn().mockResolvedValue(opts.pr),
    listPullFiles: vi.fn().mockResolvedValue(opts.files),
  } as unknown as GitHubClient;
}

function makeLlm(result: PrScorerResult): LLMClient {
  return {
    callStructured: vi.fn().mockResolvedValue(result),
  } as unknown as LLMClient;
}

const okLlm: PrScorerResult = {
  description: { status: "ok", note: "" },
  scope: { status: "ok", note: "" },
};

describe("runPrScoring", () => {
  it("skips when disabled", async () => {
    const config = parseConfig("pr_scoring:\n  enabled: false\n");
    const gh = makeGh({ pr: makePr(), files: [] });
    const llm = makeLlm(okLlm);

    const out = await runPrScoring({ config, gh, llm, ref, pullNumber: 1 });
    expect(out.skipped).toBe("disabled");
    expect(llm.callStructured).not.toHaveBeenCalled();
    expect(gh.getPull).not.toHaveBeenCalled();
  });

  it("flags description shorter than the configured minimum over a lenient LLM", async () => {
    const config = parseConfig("pr_scoring:\n  require_description_min_chars: 50\n");
    const gh = makeGh({
      pr: makePr({ body: "too short" }),
      files: [makeFile()],
    });
    // LLM says ok, but the rule should override to flag
    const llm = makeLlm(okLlm);

    const out = await runPrScoring({ config, gh, llm, ref, pullNumber: 1 });
    expect(out.report?.description.status).toBe("flag");
    expect(out.report?.description.note).toContain("50");
    expect(out.comment).toContain("Description");
  });

  it("keeps LLM description verdict when body meets minimum length", async () => {
    const config = parseConfig(undefined);
    const longBody = "This PR explains what it does and why. ".repeat(5);
    const gh = makeGh({
      pr: makePr({ body: longBody }),
      files: [makeFile()],
    });
    const llm = makeLlm({
      description: { status: "warn", note: "could be clearer" },
      scope: { status: "ok", note: "" },
    });

    const out = await runPrScoring({ config, gh, llm, ref, pullNumber: 1 });
    // Rule passed, so LLM verdict survives
    expect(out.report?.description.status).toBe("warn");
    expect(out.report?.description.note).toBe("could be clearer");
  });

  it("warns when watched paths change and no test file is present", async () => {
    const config = parseConfig(
      "pr_scoring:\n  require_tests_for_paths:\n    - \"packages/core/src/**\"\n",
    );
    const gh = makeGh({
      pr: makePr({ body: "A".repeat(200) }),
      files: [makeFile({ filename: "packages/core/src/hello.ts" })],
    });
    const llm = makeLlm(okLlm);

    const out = await runPrScoring({ config, gh, llm, ref, pullNumber: 1 });
    expect(out.report?.tests.status).toBe("warn");
    expect(out.report?.tests.note).toContain("no test files");
  });

  it("marks tests ok when a test file is included", async () => {
    const config = parseConfig(
      "pr_scoring:\n  require_tests_for_paths:\n    - \"packages/core/src/**\"\n",
    );
    const gh = makeGh({
      pr: makePr({ body: "A".repeat(200) }),
      files: [
        makeFile({ filename: "packages/core/src/hello.ts" }),
        makeFile({ filename: "packages/core/src/hello.test.ts" }),
      ],
    });
    const llm = makeLlm(okLlm);

    const out = await runPrScoring({ config, gh, llm, ref, pullNumber: 1 });
    expect(out.report?.tests.status).toBe("ok");
  });

  it("flags sensitive paths and lists them", async () => {
    const config = parseConfig(
      "pr_scoring:\n  sensitive_paths:\n    - \"packages/core/src/llm/**\"\n",
    );
    const gh = makeGh({
      pr: makePr({ body: "A".repeat(200) }),
      files: [
        makeFile({ filename: "packages/core/src/llm/prompts/shared.ts" }),
        makeFile({ filename: "README.md" }),
      ],
    });
    const llm = makeLlm(okLlm);

    const out = await runPrScoring({ config, gh, llm, ref, pullNumber: 1 });
    expect(out.report?.sensitivePaths.status).toBe("flag");
    expect(out.report?.sensitivePaths.note).toContain(
      "packages/core/src/llm/prompts/shared.ts",
    );
    expect(out.report?.sensitivePaths.note).not.toContain("README.md");
  });

  it("warns when size exceeds the threshold", async () => {
    const config = parseConfig("pr_scoring:\n  large_pr_threshold: 100\n");
    const gh = makeGh({
      pr: makePr({ additions: 200, deletions: 50, body: "A".repeat(200) }),
      files: [makeFile()],
    });
    const llm = makeLlm(okLlm);

    const out = await runPrScoring({ config, gh, llm, ref, pullNumber: 1 });
    expect(out.report?.size.status).toBe("warn");
    expect(out.report?.size.note).toContain("250");
  });

  it("omits patch from LLM input when diff_lines_per_file is 0", async () => {
    const config = parseConfig("pr_scoring:\n  diff_lines_per_file: 0\n");
    const gh = makeGh({
      pr: makePr({ body: "A".repeat(200) }),
      files: [makeFile({ patch: "@@ -1 +1 @@\n-old\n+new" })],
    });
    const callStructured = vi.fn().mockResolvedValue(okLlm);
    const llm = { callStructured } as unknown as LLMClient;

    await runPrScoring({ config, gh, llm, ref, pullNumber: 1 });

    const args = callStructured.mock.calls[0]![0];
    // User message should contain the filename but not the diff contents
    expect(args.user).toContain("hello.ts");
    expect(args.user).not.toContain("@@ -1 +1 @@");
  });

  it("includes truncated patches when diff_lines_per_file is set", async () => {
    const config = parseConfig("pr_scoring:\n  diff_lines_per_file: 2\n");
    const patch = ["line-1", "line-2", "line-3", "line-4"].join("\n");
    const gh = makeGh({
      pr: makePr({ body: "A".repeat(200) }),
      files: [makeFile({ patch })],
    });
    const callStructured = vi.fn().mockResolvedValue(okLlm);
    const llm = { callStructured } as unknown as LLMClient;

    await runPrScoring({ config, gh, llm, ref, pullNumber: 1 });

    const args = callStructured.mock.calls[0]![0];
    expect(args.user).toContain("line-1");
    expect(args.user).toContain("line-2");
    expect(args.user).not.toContain("line-3");
    expect(args.user).toContain("2 more lines");
  });
});
