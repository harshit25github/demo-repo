// lib/summarizer.js
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * updateSummaryWithOpenAI
 *  - existingSummary: string of bullet points (may be empty)
 *  - recentTurns:     array of { role: "user"|"assistant", content: string }
 * Returns: updated bullet-point summary string
 */
export async function updateSummaryWithOpenAI(existingSummary, recentTurns) {
  // 1) Format recent turns as plain text
  const recentText = recentTurns
    .map((t) =>
      t.role === "user"
        ? `User: ${t.content}`
        : `Assistant: ${t.content}`
    )
    .join("\n");

  // 2) Build your chat messages
  const messages = [
    {
      role: "system",
      content: `
You are a Conversation Memory Assistant.
Your job is to maintain an up-to-date, concise bullet-point summary of the conversation.
Rules:
  1. Only include facts or preferences that appear verbatim.
  2. Do NOT hallucinate or infer anything not explicitly stated.
  3. Preserve all named entities (places, dates, numbers, etc.).
  4. Append new bullets for new information; carry forward existing bullets unchanged.
      `.trim(),
    },
    {
      role: "system",
      content: `Existing Summary:
${existingSummary || "[none]"}`
    },
    {
      role: "system",
      content: `New Messages:
${recentText}`
    },
    {
      role: "user",
      content: `Please output exactly:

Updated Summary:
- Bullet 1...
- Bullet 2...
…`
    },
  ];

  // 3) Call OpenAI
  const resp = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",    // or "gpt-4" if you have access
    messages,
    temperature: 0,
    max_tokens: 512,
  });

  const text = resp.choices[0].message.content.trim();

  // 4) Extract lines starting with "- "
  const lines = text
    .split("\n")
    .filter((l) => l.trim().startsWith("-"))
    .map((l) => l.replace(/^- */, "").trim());

  // 5) Rebuild summary
  return lines.map((l) => `- ${l}`).join("\n");
}

// lib/db/chatSystemPrompt.js
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * 1) Ensure the join table exists, with chat_id as a UUID.
 */
export async function ensureChatSystemPromptTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_system_prompt (
      chat_id           UUID PRIMARY KEY,
      system_prompt_id  INTEGER NOT NULL
        REFERENCES system_prompts(id)
        ON DELETE CASCADE,
      assigned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * 2) Link (or re-link) a chat UUID to a system prompt ID.
 */
export async function linkChatToSystemPrompt(chatId, promptId) {
  await pool.query(
    `
    INSERT INTO chat_system_prompt(chat_id, system_prompt_id)
      VALUES($1::UUID, $2)
    ON CONFLICT (chat_id)
      DO UPDATE SET
        system_prompt_id = EXCLUDED.system_prompt_id,
        assigned_at      = NOW();
    `,
    [chatId, promptId]
  );
}

/**
 * 3) Fetch the prompt text for a given chat UUID.
 */
export async function getSystemPromptForChat(chatId) {
  const { rows } = await pool.query(
    `
    SELECT sp.prompt
      FROM system_prompts AS sp
      JOIN chat_system_prompt AS csp
        ON sp.id = csp.system_prompt_id
     WHERE csp.chat_id = $1::UUID
    `,
    [chatId]
  );
  return rows[0]?.prompt ?? null;
}

/**
 * 4) Rough token-count estimator (approx. 1.3 tokens per word).
 */
export function estimateTokenCount(text) {
  const wordCount = text.trim().split(/\s+/).length;
  return Math.ceil(wordCount * 1.3);
}

/**
 * 5) Threshold for when to trigger summarization.
 *    E.g. for a 4000-token model, we start summarizing at ~3000.
 */
export const SUMMARIZATION_TOKEN_THRESHOLD = 3000;
