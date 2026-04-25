import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubClient } from "./client.js";

// Mock Octokit
const mockPaginate = vi.fn();
const mockIssuesListForRepo = vi.fn();
const mockIssuesCreateComment = vi.fn();

vi.mock("@octokit/rest", () => ({
  Octokit: class MockOctokit {
    issues = {
      listForRepo: mockIssuesListForRepo,
      createComment: mockIssuesCreateComment,
    };
    paginate = mockPaginate;
  },
}));

describe("GitHubClient rate limiting", () => {
  let client: GitHubClient;
  const ref = { owner: "test-org", repo: "test-repo" };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GitHubClient("fake-token");
  });

  describe("countUserActivity", () => {
    it("counts only issues (not PRs) when isPullRequest is false", async () => {
      const now = new Date();
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      mockIssuesListForRepo.mockResolvedValue({
        data: [
          { number: 1, pull_request: undefined }, // regular issue
          { number: 2, pull_request: { url: "..." } }, // PR (should be excluded)
          { number: 3, pull_request: undefined }, // regular issue
        ],
      });

      const count = await (client as any).countUserActivity(ref, {
        creator: "testuser",
        since,
        isPullRequest: false,
      });

      expect(count).toBe(2);
      expect(mockIssuesListForRepo).toHaveBeenCalledWith({
        owner: "test-org",
        repo: "test-repo",
        state: "all",
        creator: "testuser",
        since: since.toISOString(),
        per_page: 100,
      });
    });

    it("counts only PRs (not issues) when isPullRequest is true", async () => {
      const now = new Date();
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      mockIssuesListForRepo.mockResolvedValue({
        data: [
          { number: 1, pull_request: undefined }, // regular issue (should be excluded)
          { number: 2, pull_request: { url: "..." } }, // PR
          { number: 3, pull_request: { url: "..." } }, // PR
          { number: 4, pull_request: { url: "..." } }, // PR
        ],
      });

      const count = await (client as any).countUserActivity(ref, {
        creator: "testuser",
        since,
        isPullRequest: true,
      });

      expect(count).toBe(3);
    });

    it("returns 0 when user has no activity", async () => {
      const now = new Date();
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      mockIssuesListForRepo.mockResolvedValue({
        data: [],
      });

      const count = await (client as any).countUserActivity(ref, {
        creator: "testuser",
        since,
        isPullRequest: false,
      });

      expect(count).toBe(0);
    });
  });

  describe("checkRateLimit", () => {
    it("allows activity when count is below limit", async () => {
      const now = new Date();

      // Mock countUserActivity to return 5 (below limit of 10)
      mockIssuesListForRepo.mockResolvedValue({
        data: Array(5).fill({ number: 1, pull_request: undefined }),
      });

      const result = await client.checkRateLimit(
        ref,
        "testuser",
        10, // limit
        24, // windowHours
        false // isPullRequest
      );

      expect(result.allowed).toBe(true);
      expect(result.count).toBe(5);
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it("blocks activity when count equals or exceeds limit", async () => {
      const now = new Date();

      // Mock countUserActivity to return 15 (above limit of 10)
      mockIssuesListForRepo.mockResolvedValue({
        data: Array(15).fill({ number: 1, pull_request: undefined }),
      });

      const result = await client.checkRateLimit(
        ref,
        "testuser",
        10, // limit
        24, // windowHours
        false
      );

      expect(result.allowed).toBe(false);
      expect(result.count).toBe(15);
    });

    it("calculates correct reset time based on window", async () => {
      mockIssuesListForRepo.mockResolvedValue({
        data: [],
      });

      const result = await client.checkRateLimit(
        ref,
        "testuser",
        10,
        1, // 1 hour window
        false
      );

      // Reset time should be approximately "now" (since `since` is 1 hour ago,
      // and resetAt = since + windowHours)
      const now = Date.now();
      const diff = Math.abs(result.resetAt.getTime() - now);
      expect(diff).toBeLessThan(5000); // within 5 seconds of now
    });
  });
});
