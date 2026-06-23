import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Is the Claude API configured for this deployment? */
export function isAIConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

/**
 * Single-turn Claude call: a grounded system prompt plus the user's question.
 * Returns the plain-text answer. Throws a friendly error when unconfigured.
 */
export async function askClaude(system: string, user: string): Promise<string> {
  if (!isAIConfigured()) {
    throw new Error(
      "دستیار هوشمند فعال نیست. کلید ANTHROPIC_API_KEY در محیط تنظیم نشده است."
    );
  }

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: user }],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
