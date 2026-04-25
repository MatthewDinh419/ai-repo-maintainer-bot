import { Octokit } from "@octokit/rest";

/** Identifies a GitHub repository (owner + name, no host). */
export interface RepoRef {
  owner: string;
  repo: string;
}

/** Normalized issue used by analyzers and prompts. */
export interface IssueSummary {
  number: number;
  title: string;
  body: string;
  createdAt: string;
  labels: string[];
}

/** One file in a pull request diff listing. */
export interface PullFileChange {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | undefined;
}

/** Metadata for a pull request (no file list; use `listPullFiles`). */
export interface PullSummary {
  number: number;
  title: string;
  body: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: string;
  fromFork: boolean;
}

/** Result of a rate limit check. */
export interface RateLimitResult {
  allowed: boolean;
  count: number;
  resetAt: Date;
}

/**
 * Thin Octokit wrapper: issues, PRs, labels, and idempotent label creation
 * (422 = already exists).
 */
export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Lists open, non-PR issues created at or after `since`, newest first, up to
   * `limit` items, excluding `excludeNumber` if set.
   */
  async listRecentOpenIssues(
    ref: RepoRef,
    opts: { since: Date; limit: number; excludeNumber?: number },
  ): Promise<IssueSummary[]> {
    const sinceIso = opts.since.toISOString();
    const { data } = await this.octokit.issues.listForRepo({
      owner: ref.owner,
      repo: ref.repo,
      state: "open",
      sort: "created",
      direction: "desc",
      since: sinceIso,
      per_page: Math.min(100, opts.limit),
    });
    return data
      .filter((i) => !i.pull_request && i.number !== opts.excludeNumber)
      .slice(0, opts.limit)
      .map((i) => ({
        number: i.number,
        title: i.title,
        body: truncate(i.body ?? "", 500),
        createdAt: i.created_at,
        labels: (i.labels ?? [])
          .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
          .filter(Boolean),
      }));
  }

  /**
   * Fetches a single issue (not a PR) by number.
   */
  async getIssue(ref: RepoRef, number: number): Promise<IssueSummary> {
    const { data } = await this.octokit.issues.get({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: number,
    });
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? "",
      createdAt: data.created_at,
      labels: (data.labels ?? [])
        .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
        .filter(Boolean),
    };
  }

  /**
   * Fetches pull request metadata and whether the head branch is from a fork.
   */
  async getPull(ref: RepoRef, number: number): Promise<PullSummary> {
    const { data } = await this.octokit.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: number,
    });
    const fromFork = data.head.repo?.full_name !== data.base.repo.full_name;
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? "",
      draft: Boolean(data.draft),
      additions: data.additions,
      deletions: data.deletions,
      changedFiles: data.changed_files,
      author: data.user?.login ?? "unknown",
      fromFork,
    };
  }

  /**
   * Paginates all files in a PR (additions, deletions, optional patch).
   */
  async listPullFiles(ref: RepoRef, number: number): Promise<PullFileChange[]> {
    const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: number,
      per_page: 100,
    });
    return files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }

  /**
   * All label names in the repository.
   */
  async listRepoLabels(ref: RepoRef): Promise<string[]> {
    const labels = await this.octokit.paginate(this.octokit.issues.listLabelsForRepo, {
      owner: ref.owner,
      repo: ref.repo,
      per_page: 100,
    });
    return labels.map((l) => l.name);
  }

  /**
   * Returns the ID of the first comment whose body contains the marker, or
   * null if none exists. Used to decide whether to create or update.
   */
  async findBotComment(
    ref: RepoRef,
    number: number,
    marker: string,
  ): Promise<number | null> {
    const comments = await this.octokit.paginate(
      this.octokit.issues.listComments,
      { owner: ref.owner, repo: ref.repo, issue_number: number, per_page: 100 },
    );
    const match = comments.find((c) => (c.body ?? "").includes(marker));
    return match?.id ?? null;
  }

  /**
   * True if any issue comment body contains the given marker (dedupe bot posts).
   */
  async hasExistingBotComment(
    ref: RepoRef,
    number: number,
    marker: string,
  ): Promise<boolean> {
    const id = await this.findBotComment(ref, number, marker);
    return id !== null;
  }

  /**
   * Appends a new comment on an issue or PR.
   */
  async createIssueComment(ref: RepoRef, number: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: number,
      body,
    });
  }

  /**
   * Edits an existing comment by ID.
   */
  async updateIssueComment(ref: RepoRef, commentId: number, body: string): Promise<void> {
    await this.octokit.issues.updateComment({
      owner: ref.owner,
      repo: ref.repo,
      comment_id: commentId,
      body,
    });
  }

  /**
   * Adds labels; no-ops if `labels` is empty.
   */
  async addLabels(ref: RepoRef, number: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    await this.octokit.issues.addLabels({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: number,
      labels,
    });
  }

  /**
   * Creates a label if it does not exist; ignores GitHub 422 (name taken).
   */
  async createLabelIfMissing(
    ref: RepoRef,
    name: string,
    color = "ededed",
    description = "",
  ): Promise<void> {
    try {
      await this.octokit.issues.createLabel({
        owner: ref.owner,
        repo: ref.repo,
        name,
        color,
        description,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 422) return;
      throw err;
    }
  }

  /**
   * Counts issues or PRs created by a specific user since the given time.
   * Used for rate limiting to detect spam/burst behavior.
   */
  async countUserActivity(
    ref: RepoRef,
    opts: { creator: string; since: Date; isPullRequest: boolean },
  ): Promise<number> {
    const { data } = await this.octokit.issues.listForRepo({
      owner: ref.owner,
      repo: ref.repo,
      state: "all",
      creator: opts.creator,
      since: opts.since.toISOString(),
      per_page: 100,
    });
    // Filter to only issues or only PRs based on isPullRequest flag
    const filtered = data.filter((item) => {
      const isPR = !!item.pull_request;
      return isPR === opts.isPullRequest;
    });
    return filtered.length;
  }

  /**
   * Checks if a user has exceeded the rate limit for issues or PRs.
   * Returns rate limit status and when the window resets.
   */
  async checkRateLimit(
    ref: RepoRef,
    creator: string,
    limit: number,
    windowHours: number,
    isPullRequest: boolean,
  ): Promise<RateLimitResult> {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const count = await this.countUserActivity(ref, {
      creator,
      since,
      isPullRequest,
    });
    const resetAt = new Date(since.getTime() + windowHours * 60 * 60 * 1000);
    return {
      allowed: count < limit,
      count,
      resetAt,
    };
  }
}

/** Truncates long issue bodies for candidate lists. */
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
