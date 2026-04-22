import * as core from "@actions/core";
import {
  runLabelClassification,
  runPrScoring,
  type Config,
  type GitHubClient,
  type LLMClient,
  type RepoRef,
} from "@ai-repo-maintainer/core";

export interface OnPullRequestDeps {
  config: Config;
  gh: GitHubClient;
  llm: LLMClient;
  ref: RepoRef;
  pullNumber: number;
  action: "opened" | "synchronize" | "ready_for_review";
}

export async function onPullRequest(deps: OnPullRequestDeps): Promise<void> {
  const { config, gh, ref, pullNumber, action } = deps;
  const dry = config.general.dry_run;

  const pr = await gh.getPull(ref, pullNumber);

  if (pr.draft && action !== "ready_for_review") {
    core.info(`PR #${pullNumber} is a draft; skipping until ready_for_review`);
    return;
  }

  const BOT_MARKER = "Posted by ai-repo-maintainer-bot";
  const alreadyCommented = await gh.hasExistingBotComment(ref, pullNumber, BOT_MARKER);
  if (alreadyCommented) {
    core.info(`bot already commented on #${pullNumber}, skipping to avoid duplicate posts`);
    return;
  }

  const score = await runPrScoring(deps);
  if (score.comment) {
    core.info(`posting PR score comment on #${pullNumber}`);
    if (!dry) {
      await gh.createIssueComment(ref, pullNumber, score.comment);
    }
  } else if (score.skipped) {
    core.info(`pr scoring skipped: ${score.skipped}`);
  }

  if (action === "opened" || action === "ready_for_review") {
    const labels = await runLabelClassification({
      config,
      gh,
      llm: deps.llm,
      ref,
      kind: "pull_request",
      number: pullNumber,
      title: pr.title,
      body: pr.body,
    });
    if (labels.appliedLabels.length > 0 && !dry && !config.labeling.require_confirmation) {
      const repoLabels = new Set(await gh.listRepoLabels(ref));
      const existing = labels.appliedLabels.filter((l) => repoLabels.has(l));
      if (existing.length > 0) {
        await gh.addLabels(ref, pullNumber, existing);
      }
    }
  }
}
