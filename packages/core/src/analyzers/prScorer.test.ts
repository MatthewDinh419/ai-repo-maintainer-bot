import { describe, expect, it } from "vitest";
import { globLike } from "./prScorer.js";

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
