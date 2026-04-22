#!/usr/bin/env node
import {
  GitHubClient,
  LLMClient,
  loadConfigFromFile,
  runDuplicateDetection,
  runLabelClassification,
  runPrScoring,
} from "@ai-repo-maintainer/core";

interface ParsedArgs {
  command: "duplicate" | "label" | "score";
  repo: string;
  number: number;
  configPath: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args[0] as ParsedArgs["command"] | undefined;
  if (!command || !["duplicate", "label", "score"].includes(command)) {
    usageAndExit();
  }
  const opts: Record<string, string> = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i];
    const val = args[i + 1];
    if (!key || val === undefined) usageAndExit();
    opts[key.replace(/^--/, "")] = val;
  }
  if (!opts.repo || !opts.number) usageAndExit();
  return {
    command: command!,
    repo: opts.repo!,
    number: Number(opts.number),
    configPath: opts.config ?? ".maintainer-bot.yml",
  };
}

function usageAndExit(): never {
  console.error(
    `Usage: maintainer-bot <duplicate|label|score> --repo owner/name --number N [--config path]\n` +
      `Requires env: GITHUB_TOKEN, ANTHROPIC_API_KEY`,
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const ghToken = process.env.GITHUB_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!ghToken || !anthropicKey) usageAndExit();

  const [owner, repo] = args.repo.split("/");
  if (!owner || !repo) usageAndExit();
  const ref = { owner, repo };

  const config = loadConfigFromFile(args.configPath);
  config.general.dry_run = true;

  const gh = new GitHubClient(ghToken);
  const llm = new LLMClient(anthropicKey, config.general.model);

  if (args.command === "duplicate") {
    const result = await runDuplicateDetection({
      config,
      gh,
      llm,
      ref,
      issueNumber: args.number,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (args.command === "label") {
    const issue = await gh.getIssue(ref, args.number);
    const result = await runLabelClassification({
      config,
      gh,
      llm,
      ref,
      kind: "issue",
      number: args.number,
      title: issue.title,
      body: issue.body,
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    const result = await runPrScoring({
      config,
      gh,
      llm,
      ref,
      pullNumber: args.number,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.comment) {
      console.log("\n--- rendered comment ---\n");
      console.log(result.comment);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
