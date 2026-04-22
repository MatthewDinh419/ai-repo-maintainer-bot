import { Octokit } from "@octokit/rest";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  body: string;
  createdAt: string;
  labels: string[];
}

export interface PullFileChange {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | undefined;
}

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

export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

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

  async listRepoLabels(ref: RepoRef): Promise<string[]> {
    const labels = await this.octokit.paginate(this.octokit.issues.listLabelsForRepo, {
      owner: ref.owner,
      repo: ref.repo,
      per_page: 100,
    });
    return labels.map((l) => l.name);
  }

  async createIssueComment(ref: RepoRef, number: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: number,
      body,
    });
  }

  async addLabels(ref: RepoRef, number: number, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    await this.octokit.issues.addLabels({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: number,
      labels,
    });
  }

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
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
