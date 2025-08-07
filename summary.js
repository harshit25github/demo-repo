You will see two things:

  1) A second SYSTEM message containing the existing bullet‐point summary.
     It always starts with “Summary:”.

  2) A USER message whose content is multiple lines beginning with “User:” or “Assistant:”.
     This is the raw recent chat turns.
  // lib/db/chatMemory.js
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 1) Ensure the chat_memory table exists
export async function ensureChatMemoryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_memory (
      chat_id                 UUID PRIMARY KEY,
      memory_summary          TEXT    NOT NULL DEFAULT '',
      unsummarized_turns      JSONB   NOT NULL DEFAULT '[]',
      unsummarized_token_count INTEGER NOT NULL DEFAULT 0,
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// 2) Load the memory state for a given chat
export async function getChatMemory(chatId) {
  const { rows } = await pool.query(
    `SELECT memory_summary, unsummarized_turns, unsummarized_token_count
       FROM chat_memory
      WHERE chat_id = $1::UUID`,
    [chatId]
  );
  if (rows.length === 0) {
    return {
      memorySummary: "",
      unsummarizedTurns: [],
      unsummarizedTokenCount: 0,
    };
  }
  const { memory_summary, unsummarized_turns, unsummarized_token_count } = rows[0];
  return {
    memorySummary: memory_summary,
    unsummarizedTurns: unsummarized_turns,
    unsummarizedTokenCount: unsummarized_token_count,
  };
}

// 3) Upsert the memory state after processing
export async function saveChatMemory(
  chatId,
  memorySummary,
  unsummarizedTurns,
  unsummarizedTokenCount
) {
  await pool.query(
    `
    INSERT INTO chat_memory(
      chat_id, memory_summary, unsummarized_turns, unsummarized_token_count
    ) VALUES (
      $1::UUID, $2, $3::JSONB, $4
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      memory_summary          = EXCLUDED.memory_summary,
      unsummarized_turns      = EXCLUDED.unsummarized_turns,
      unsummarized_token_count= EXCLUDED.unsummarized_token_count,
      updated_at              = NOW()
    `,
    [chatId, memorySummary, JSON.stringify(unsummarizedTurns), unsummarizedTokenCount]
  );
}

// 4) (Optional) Rough token‐count estimator
export function estimateTokenCount(text) {
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(words * 1.3);
}

// 5) Threshold
export const SUMMARIZATION_TOKEN_THRESHOLD = 3000;

----
  import express from "express";
import OpenAI from "openai";
import {
  ensureChatMemoryTable,
  getChatMemory,
  saveChatMemory,
  estimateTokenCount,
  SUMMARIZATION_TOKEN_THRESHOLD,
} from "@/lib/db/chatMemory";
import { updateSummaryWithOpenAI } from "@/lib/summarizer";

const app = express();
app.use(express.json());
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 1) On startup, ensure the table exists
await ensureChatMemoryTable();

app.post("/chat/:chatId", async (req, res) => {
  const { chatId } = req.params;
  const { message: userMessage } = req.body;
  if (!userMessage) return res.status(400).send("message required");

  // 2) Load existing state
  let {
    memorySummary,
    unsummarizedTurns,
    unsummarizedTokenCount
  } = await getChatMemory(chatId);

  // 3) Add the new user turn
  unsummarizedTurns.push({ role: "user", content: userMessage });
  unsummarizedTokenCount += estimateTokenCount(userMessage);

  // 4) If the new chunk exceeds threshold, re-summarize
  if (unsummarizedTokenCount > SUMMARIZATION_TOKEN_THRESHOLD) {
    memorySummary = await updateSummaryWithOpenAI(
      memorySummary,
      unsummarizedTurns
    );
    unsummarizedTurns = [];
    unsummarizedTokenCount = 0;
  }

  // 5) Build the prompt for OpenAI
  const messages = [
    { role: "system", content: "You are a travel assistant." },
    ...(memorySummary
      ? [{ role: "system", content: `Summary so far:\n${memorySummary}` }]
      : []),
    ...unsummarizedTurns.map(t => ({
      role: t.role,
      content: t.content
    }))
  ];

  // 6) Get the assistant’s reply
  const chatRes = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });
  const assistantReply = chatRes.choices[0].message.content;

  // 7) Append that to unsummarized buffer
  unsummarizedTurns.push({ role: "assistant", content: assistantReply });
  unsummarizedTokenCount += estimateTokenCount(assistantReply);

  // 8) Persist the updated state
  await saveChatMemory(
    chatId,
    memorySummary,
    unsummarizedTurns,
    unsummarizedTokenCount
  );

  // 9) Return the reply
  res.json({ reply: assistantReply });
});

app.listen(3000, () => console.log("🚀 on port 3000"));
