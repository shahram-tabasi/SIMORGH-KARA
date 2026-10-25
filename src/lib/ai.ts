import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// The model behind Kara's assistants (the leave assistant). First choice: the
// office's own LLM service (simorgh-technical-chatbot-cloud docs/LLM-API.md,
// OpenAI-compatible, one key per app: `llm-api-key.sh create kara`, stored by
// deploy/helm/simorgh-kara/scripts/setup.sh llm-key). The Claude API only when
// no office key is set and ANTHROPIC_API_KEY is.

const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://llm.simorghai.com/v1").replace(/\/+$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "qwen3.8-27b-nothink";
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

const officeLLM = () => !!process.env.LLM_API_KEY;

/** Is a model configured for this deployment? */
export function isAIConfigured(): boolean {
  return officeLLM() || !!process.env.ANTHROPIC_API_KEY;
}

/**
 * One question to the model: a grounded system prompt plus the user's
 * question. Returns the plain-text answer; throws a friendly error when no
 * model is configured or the service does not answer.
 */
export async function askAI(system: string, user: string): Promise<string> {
  if (officeLLM()) return askOffice(system, user);
  if (process.env.ANTHROPIC_API_KEY) return askClaude(system, user);
  throw new Error("دستیار هوشمند فعال نیست: کلید LLM تنظیم نشده است.");
}

async function askOffice(system: string, user: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.LLM_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.2,
        max_tokens: 1500,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", context: "llm", message: (e as Error).message }));
    throw new Error("سرویس هوش مصنوعی در دسترس نیست؛ کمی بعد دوباره بپرسید.");
  }
  if (!res.ok) {
    console.error(JSON.stringify({ level: "error", context: "llm", status: res.status, body: (await res.text()).slice(0, 300) }));
    throw new Error(res.status === 429
      ? "سرویس هوش مصنوعی پرمشغله است؛ چند لحظه بعد دوباره بپرسید."
      : "پاسخ آماده نشد؛ کمی بعد دوباره بپرسید.");
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  // Some models write their reasoning in <think> before the answer.
  return (data.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function askClaude(system: string, user: string): Promise<string> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
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
