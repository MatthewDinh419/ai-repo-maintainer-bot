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
