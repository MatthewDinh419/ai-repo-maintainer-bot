import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLMClient } from "./client.js";

// Hoist the mock function so it's available inside the vi.mock factory and
// still referenceable from the tests below. vi.mock itself is hoisted above
// all imports, so LLMClient picks up the mocked SDK.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: createMock },
  })),
}));

beforeEach(() => {
  createMock.mockReset();
});

const baseOpts = {
  system: "you are a test",
  user: "do the thing",
  toolName: "report_thing",
  toolDescription: "desc",
  inputSchema: { type: "object" } as Record<string, unknown>,
  parse: (raw: unknown) => raw as { ok: boolean },
};

describe("LLMClient.callStructured", () => {
  it("parses the input of a tool_use block", async () => {
    createMock.mockResolvedValue({
      content: [
        { type: "text", text: "some preamble" },
        { type: "tool_use", name: "report_thing", input: { ok: true } },
      ],
    });

    const llm = new LLMClient("key", "claude-sonnet-4-6");
    const result = await llm.callStructured(baseOpts);

    expect(result).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("sends the configured model, system text, tool schema, and forced tool_choice", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "tool_use", name: "report_thing", input: { ok: true } }],
    });

    const llm = new LLMClient("key", "claude-sonnet-4-6");
    await llm.callStructured(baseOpts);

    const args = createMock.mock.calls[0]![0];
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.tool_choice).toEqual({ type: "tool", name: "report_thing" });
    expect(args.tools[0].name).toBe("report_thing");
    expect(args.tools[0].input_schema).toEqual({ type: "object" });
    // System is wrapped as a block with ephemeral cache_control
    expect(Array.isArray(args.system)).toBe(true);
    expect(args.system[0].text).toBe("you are a test");
    expect(args.system[0].cache_control).toEqual({ type: "ephemeral" });
    // User turn is passed as a single message
    expect(args.messages).toEqual([{ role: "user", content: "do the thing" }]);
  });

  it("uses the provided max_tokens or a default of 1024", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "tool_use", name: "report_thing", input: {} }],
    });

    const llm = new LLMClient("key", "claude-sonnet-4-6");
    await llm.callStructured(baseOpts);
    expect(createMock.mock.calls[0]![0].max_tokens).toBe(1024);

    await llm.callStructured({ ...baseOpts, maxTokens: 200 });
    expect(createMock.mock.calls[1]![0].max_tokens).toBe(200);
  });

  it("throws when the response has no tool_use block", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "model refused to use the tool" }],
    });

    const llm = new LLMClient("key", "claude-sonnet-4-6");
    await expect(llm.callStructured(baseOpts)).rejects.toThrow(/report_thing/);
  });

  it("invokes the parse function on the tool input", async () => {
    createMock.mockResolvedValue({
      content: [
        { type: "tool_use", name: "report_thing", input: { count: 3 } },
      ],
    });

    const parse = vi.fn((raw: unknown) => {
      const r = raw as { count: number };
      return { doubled: r.count * 2 };
    });

    const llm = new LLMClient("key", "claude-sonnet-4-6");
    const out = await llm.callStructured({ ...baseOpts, parse });

    expect(parse).toHaveBeenCalledWith({ count: 3 });
    expect(out).toEqual({ doubled: 6 });
  });

  it("propagates SDK errors", async () => {
    createMock.mockRejectedValue(new Error("rate limited"));
    const llm = new LLMClient("key", "claude-sonnet-4-6");
    await expect(llm.callStructured(baseOpts)).rejects.toThrow("rate limited");
  });
});
