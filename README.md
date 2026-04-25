# ai-repo-maintainer-bot

A GitHub Action that uses Claude to perform first-pass triage on every new issue and PR — surfacing duplicates, applying labels, and scoring PR quality. **It never closes or rejects anything.** It comments and labels so humans can decide faster.

## Install

Add `.github/workflows/maintainer-bot.yml` to your repo:

```yaml
name: Maintainer bot
on:
  issues:
    types: [opened]
  pull_request:
    types: [opened, synchronize, ready_for_review, edited]
  issue_comment:
    types: [created, edited]
  pull_request_review_comment:
    types: [created, edited]

concurrency:
  group: maintainer-bot-${{ github.event.issue.number || github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: ai-repo-maintainer-bot/action@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Then add `ANTHROPIC_API_KEY` under Settings → Secrets and variables → Actions. Optionally drop a `.maintainer-bot.yml` in the repo root — see [example](./.maintainer-bot.yml).

## Three analyzers

- **Duplicate detection** (issues) — fetches the last N open issues and asks Claude whether the new issue is a dup. If confidence ≥ threshold, posts a comment and adds a `possible-duplicate` label.
- **Auto-labeling** (issues + PRs) — classifies against your label definitions (plain English, not just names).
- **PR quality scoring** (PRs) — posts a five-dimension report: description, scope, tests, sensitive paths, size.

Each analyzer uses Claude's tool-use with a forced schema — no brittle JSON regex.

## Known caveats

- **Prompt injection.** Issue/PR bodies are untrusted. All user-authored text is wrapped in `<untrusted>` tags with an explicit notice to Claude to treat it as data. Don't grant this Action write access to code or secrets beyond what's needed.
- **Fork PRs.** The workflow here uses `pull_request`, so PRs from forks get a read-only `GITHUB_TOKEN` and the bot won't be able to label or comment on them. Using `pull_request_target` fixes that but [runs the base branch's workflow with full secrets and access to the fork's head ref](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/) — only enable it if you understand the tradeoffs and keep the action locked to a pinned SHA.
- **GitHub's search-based dup detection scales to ~5k issues.** Embedding-based search is a tracked stretch goal (M6).
- **Bundled dist is committed.** GitHub JS actions don't run `npm install` at trigger time, so `packages/action/dist/` ships pre-bundled via `ncc`. CI fails if it's stale.

## Repo layout

```
packages/
  core/    shared utilities — GitHub client, LLM client, prompts, analyzers, config
  action/  action entry point + handlers + action.yml
  cli/     local testing CLI (dry-run only)
.github/workflows/
  maintainer-bot.yml   dogfood on this repo
  ci.yml               tests, typecheck, bundle freshness check
.maintainer-bot.yml    bot config for this repo
```

## Local testing

```bash
export GITHUB_TOKEN=...
export ANTHROPIC_API_KEY=...
pnpm install
pnpm build
pnpm --filter @ai-repo-maintainer/cli start -- duplicate --repo owner/name --number 42
```

The CLI runs in forced dry-run mode and prints JSON. It does not post or label.

## Development

```bash
pnpm install
pnpm build         # build all packages
pnpm test          # vitest
pnpm typecheck
pnpm bundle        # rebuild packages/action/dist/index.js (must be committed)
```
