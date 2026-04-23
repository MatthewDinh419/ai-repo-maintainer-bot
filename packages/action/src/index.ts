import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  GitHubClient,
  LLMClient,
  loadConfigFromFile,
} from "@ai-repo-maintainer/core";
import { onIssueOpened } from "./handlers/onIssueOpened.js";
import { onPullRequest } from "./handlers/onPullRequest.js";

async function main(): Promise<void> {
  const anthropicKey = core.getInput("anthropic-api-key", { required: true });
  const githubToken = core.getInput("github-token", { required: true });
  const configPath = core.getInput("config-path") || ".maintainer-bot.yml";
  const modelOverride = core.getInput("model");

  const config = loadConfigFromFile(configPath);
  if (modelOverride) config.general.model = modelOverride;

  core.setSecret(anthropicKey);

  const gh = new GitHubClient(githubToken);
  const llm = new LLMClient(anthropicKey, config.general.model);

  const ctx = github.context;
  const ref = { owner: ctx.repo.owner, repo: ctx.repo.repo };

  core.info(
    `event=${ctx.eventName} action=${ctx.payload.action} dry_run=${config.general.dry_run}`,
  );

  if (ctx.eventName === "issues" && ctx.payload.action === "opened") {
    const issueNumber = ctx.payload.issue?.number;
    if (!issueNumber) throw new Error("issues.opened payload missing issue.number");
    await onIssueOpened({ config, gh, llm, ref, issueNumber });
    return;
  }

  if (
    ctx.eventName === "pull_request" ||
    ctx.eventName === "pull_request_target"
  ) {
    const action = ctx.payload.action;
    if (!["opened", "synchronize", "ready_for_review", "edited"].includes(action ?? "")) {
      core.info(`ignoring pull_request action: ${action}`);
      return;
    }
    const pullNumber = ctx.payload.pull_request?.number;
    if (!pullNumber) {
      throw new Error("pull_request payload missing pull_request.number");
    }
    await onPullRequest({
      config,
      gh,
      llm,
      ref,
      pullNumber,
      action: action as "opened" | "synchronize" | "ready_for_review" | "edited",
    });
    return;
  }

  core.info(`unhandled event: ${ctx.eventName}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  core.setFailed(msg);
});
