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
