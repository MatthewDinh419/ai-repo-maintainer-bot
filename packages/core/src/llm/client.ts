import Anthropic from "@anthropic-ai/sdk";

export interface StructuredCallOptions<T> {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
  parse: (raw: unknown) => T;
}

export class LLMClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async callStructured<T>(opts: StructuredCallOptions<T>): Promise<T> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: [
        // cache_control is supported at runtime but not always reflected in the
        // SDK's TypeScript types depending on version — cast through unknown.
        {
          type: "text",
          text: opts.system,
          cache_control: { type: "ephemeral" },
        } as unknown as Anthropic.TextBlockParam,
      ],
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: opts.inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: opts.toolName },
      messages: [{ role: "user", content: opts.user }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      throw new Error(`LLM did not return a tool_use block for ${opts.toolName}`);
    }
    return opts.parse(toolUse.input);
  }
}
