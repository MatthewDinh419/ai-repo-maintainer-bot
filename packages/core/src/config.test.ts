import { describe, expect, it } from "vitest";
import { parseConfig, parseDuration } from "./config.js";

describe("parseConfig", () => {
  it("applies defaults to an empty config", () => {
    const c = parseConfig(undefined);
    expect(c.duplicate_detection.threshold).toBe(0.8);
    expect(c.labeling.enabled).toBe(true);
    expect(c.general.model).toBe("claude-sonnet-4-6");
  });

  it("accepts user overrides", () => {
    const c = parseConfig(
      "duplicate_detection:\n  threshold: 0.6\ngeneral:\n  dry_run: true\n",
    );
    expect(c.duplicate_detection.threshold).toBe(0.6);
    expect(c.general.dry_run).toBe(true);
  });

  it("rejects out-of-range thresholds", () => {
    expect(() => parseConfig("duplicate_detection:\n  threshold: 1.5\n")).toThrow();
  });

  it("applies rate limiting defaults", () => {
    const c = parseConfig(undefined);
    expect(c.rate_limiting.enabled).toBe(true);
    expect(c.rate_limiting.max_issues_per_hour).toBe(10);
    expect(c.rate_limiting.max_prs_per_hour).toBe(10);
    expect(c.rate_limiting.window_hours).toBe(24);
  });

  it("accepts rate limiting overrides", () => {
    const c = parseConfig(`
rate_limiting:
  enabled: false
  max_issues_per_hour: 5
  max_prs_per_hour: 3
  window_hours: 12
`);
    expect(c.rate_limiting.enabled).toBe(false);
    expect(c.rate_limiting.max_issues_per_hour).toBe(5);
    expect(c.rate_limiting.max_prs_per_hour).toBe(3);
    expect(c.rate_limiting.window_hours).toBe(12);
  });

  it("rejects invalid rate limiting values", () => {
    expect(() => parseConfig("rate_limiting:\n  window_hours: 200\n")).toThrow(); // max 168
    expect(() => parseConfig("rate_limiting:\n  max_issues_per_hour: 0\n")).toThrow(); // min 1
    expect(() => parseConfig("rate_limiting:\n  max_prs_per_hour: -1\n")).toThrow(); // min 1
  });
});

describe("parseDuration", () => {
  it("parses days, hours, minutes", () => {
    expect(parseDuration("1d")).toBe(86_400_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("30m")).toBe(1_800_000);
  });

  it("rejects invalid durations", () => {
    expect(() => parseDuration("1w")).toThrow();
  });
});
