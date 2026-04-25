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
  action: "opened" | "synchronize" | "ready_for_review" | "edited";
}

export async function onPullRequest(deps: OnPullRequestDeps): Promise<void> {
  const { config, gh, ref, pullNumber, action } = deps;
  const dry = config.general.dry_run;

  core.info(`handling PR #${pullNumber} action=${action}`);

  const pr = await gh.getPull(ref, pullNumber);

  // --- Rate limiting (only check on open to avoid counting updates as new PRs) ---
  if (config.rate_limiting.enabled && (action === "opened" || action === "edited")) {
    const rateCheck = await gh.checkRateLimit(
      ref,
      pr.author,
      config.rate_limiting.max_prs_per_hour * config.rate_limiting.window_hours,
      config.rate_limiting.window_hours,
      true, // isPullRequest = true
    );
    if (!rateCheck.allowed) {
      core.info(`rate limit exceeded for user ${pr.author}: ${rateCheck.count} PRs in ${config.rate_limiting.window_hours}h`);
      if (!dry) {
        const existingCommentId = await gh.findBotComment(ref, pullNumber, "Posted by ai-repo-maintainer-bot");
        const body = `👋 Hi @${pr.author}! You've created ${rateCheck.count} PRs in the last ${config.rate_limiting.window_hours} hours. ` +
          `To prevent spam, I'll skip AI analysis for now. A human maintainer will review this soon. ` +
          `Thanks for your understanding!`;
        if (existingCommentId !== null) {
          await gh.updateIssueComment(ref, existingCommentId, body);
        } else {
          await gh.createIssueComment(ref, pullNumber, body);
        }
      }
      return;
    }
    core.info(`rate limit check passed: ${rateCheck.count}/${config.rate_limiting.max_prs_per_hour * config.rate_limiting.window_hours} PRs`);
  }
  core.info(`PR title: "${pr.title}" | ${pr.additions}+/${pr.deletions}- lines | draft=${pr.draft}`);

  if (pr.draft && action !== "ready_for_review") {
    core.info(`PR #${pullNumber} is a draft; skipping until ready_for_review`);
    return;
  }

  const BOT_MARKER = "Posted by ai-repo-maintainer-bot";

  // --- PR scoring ---
  core.info("running PR scoring...");
  const score = await runPrScoring(deps);
  if (score.skipped) {
    core.info(`pr scoring skipped: ${score.skipped}`);
  } else if (score.report) {
    const r = score.report;
    core.info(
      `score results: description=${r.description.status} scope=${r.scope.status} ` +
      `tests=${r.tests.status} sensitivePaths=${r.sensitivePaths.status} size=${r.size.status}`,
    );
    if (score.comment) {
      const existingCommentId = await gh.findBotComment(ref, pullNumber, BOT_MARKER);
      if (existingCommentId !== null) {
        core.info(`updating existing score comment (id=${existingCommentId}) on #${pullNumber}`);
        if (!dry) await gh.updateIssueComment(ref, existingCommentId, score.comment);
      } else {
        core.info(`posting new score comment on #${pullNumber}`);
        if (!dry) await gh.createIssueComment(ref, pullNumber, score.comment);
      }
    }
  }

  // --- Labeling (only on open/ready, not on every push) ---
  if (action === "opened" || action === "ready_for_review" || action === "edited") {
    core.info("running label classification...");
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

    if (labels.skipped) {
      core.info(`labeling skipped: ${labels.skipped}`);
    } else if (labels.appliedLabels.length === 0) {
      core.info("LLM suggested no labels");
    } else {
      core.info(`LLM suggested labels: ${labels.appliedLabels.join(", ")}`);
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
          core.info(`applying labels: ${existing.join(", ")}`);
          await gh.addLabels(ref, pullNumber, existing);
        }
      }
    }
  }
}
