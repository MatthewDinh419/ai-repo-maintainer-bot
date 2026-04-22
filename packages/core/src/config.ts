import { readFileSync, existsSync } from "node:fs";
import yaml from "js-yaml";
import { z } from "zod";

const DurationSchema = z
  .string()
  .regex(/^\d+[dhm]$/)
  .default("90d");

export const ConfigSchema = z.object({
  duplicate_detection: z
    .object({
      enabled: z.boolean().default(true),
      threshold: z.number().min(0).max(1).default(0.8),
      search_window: DurationSchema,
      max_candidates: z.number().int().min(1).max(200).default(50),
    })
    .default({}),
  labeling: z
    .object({
      enabled: z.boolean().default(true),
      labels: z.record(z.string(), z.string()).default({
        bug: "reports something broken or behaving unexpectedly",
        feature: "requests new functionality",
        docs: "relates to documentation or examples",
        performance: "relates to speed, memory, or resource usage",
        security: "potential security vulnerability",
        "breaking-change": "introduces a breaking API or behavior change",
        "good-first-issue": "well-scoped, approachable for new contributors",
        "needs-info": "missing information required to triage",
      }),
      require_confirmation: z.boolean().default(false),
      auto_create_missing: z.boolean().default(false),
    })
    .default({}),
  pr_scoring: z
    .object({
      enabled: z.boolean().default(true),
      require_description_min_chars: z.number().int().min(0).default(50),
      require_tests_for_paths: z.array(z.string()).default(["src/**"]),
      sensitive_paths: z.array(z.string()).default([]),
      large_pr_threshold: z.number().int().min(1).default(500),
    })
    .default({}),
  general: z
    .object({
      dry_run: z.boolean().default(false),
      bot_comment_footer: z.boolean().default(true),
      model: z.string().default("claude-sonnet-4-6"),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(source: string | undefined): Config {
  const raw = source ? (yaml.load(source) as unknown) : {};
  return ConfigSchema.parse(raw ?? {});
}

export function loadConfigFromFile(path: string): Config {
  if (!existsSync(path)) return ConfigSchema.parse({});
  return parseConfig(readFileSync(path, "utf8"));
}

export function parseDuration(d: string): number {
  const match = /^(\d+)([dhm])$/.exec(d);
  if (!match) throw new Error(`invalid duration: ${d}`);
  const n = Number(match[1]!);
  const unit = match[2]!;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return n * 60 * 1000;
}
