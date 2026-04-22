import * as core from "@actions/core";
import {
  runDuplicateDetection,
  runLabelClassification,
  type Config,
  type GitHubClient,
  type LLMClient,
  type RepoRef,
} from "@ai-repo-maintainer/core";

export interface OnIssueOpenedDeps {
  config: Config;
  gh: GitHubClient;
  llm: LLMClient;
  ref: RepoRef;
  issueNumber: number;
}

export async function onIssueOpened(deps: OnIssueOpenedDeps): Promise<void> {
  const { config, gh, ref, issueNumber } = deps;
  const dry = config.general.dry_run;

  const BOT_MARKER = "Posted by ai-repo-maintainer-bot";
  const alreadyCommented = await gh.hasExistingBotComment(ref, issueNumber, BOT_MARKER);
  if (alreadyCommented) {
    core.info(`bot already commented on #${issueNumber}, skipping to avoid duplicate posts`);
    return;
  }

  const dup = await runDuplicateDetection(deps);
  if (dup.flagged && dup.comment) {
    core.info(`duplicate flagged for #${issueNumber}: ${dup.result?.matching_issue_number}`);
    if (!dry) {
      await gh.createIssueComment(ref, issueNumber, dup.comment);
      if (dup.label) {
        if (config.labeling.auto_create_missing) {
          await gh.createLabelIfMissing(ref, dup.label, "fbca04", "Possible duplicate issue");
        }
        await safeAddLabel(gh, ref, issueNumber, dup.label);
      }
    }
  } else if (dup.skipped) {
    core.info(`duplicate detection skipped: ${dup.skipped}`);
  } else {
    core.info(
      `no duplicate (confidence=${dup.result?.confidence ?? "n/a"})`,
    );
  }

  const issue = await gh.getIssue(ref, issueNumber);
  const labels = await runLabelClassification({
    config,
    gh,
    llm: deps.llm,
    ref,
    kind: "issue",
    number: issueNumber,
    title: issue.title,
    body: issue.body,
  });

  if (labels.appliedLabels.length > 0) {
    core.info(`labels: ${labels.appliedLabels.join(", ")}`);
    if (!dry) {
      const repoLabels = new Set(await gh.listRepoLabels(ref));
      const existing = labels.appliedLabels.filter((l) => repoLabels.has(l));
      const missing = labels.appliedLabels.filter((l) => !repoLabels.has(l));

      if (config.labeling.auto_create_missing) {
        for (const name of missing) {
          await gh.createLabelIfMissing(ref, name, "ededed", config.labeling.labels[name] ?? "");
          existing.push(name);
        }
      } else if (missing.length > 0) {
        core.warning(
          `skipping labels not in repo (auto_create_missing is false): ${missing.join(", ")}`,
        );
      }

      if (existing.length > 0) {
        await gh.addLabels(ref, issueNumber, existing);
      }
    }
  }
}

async function safeAddLabel(
  gh: GitHubClient,
  ref: RepoRef,
  number: number,
  label: string,
): Promise<void> {
  try {
    await gh.addLabels(ref, number, [label]);
  } catch (err) {
    core.warning(`failed to add label ${label}: ${(err as Error).message}`);
  }
}
