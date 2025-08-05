// app.js
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const PORT          = process.env.PORT || 3000;
const LLAMA_API_URL = process.env.LLAMA_API_URL;      // e.g. "http://localhost:8000/generate"
const OPENAI_API_KEY= process.env.OPENAI_API_KEY;
const TOKEN_LIMIT   = 3000;  // max tokens before re-summarizing

if (!LLAMA_API_URL || !OPENAI_API_KEY) {
  console.error("⚠️  Set LLAMA_API_URL and OPENAI_API_KEY in .env");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const app    = express();
app.use(bodyParser.json());

// In-memory state (per user in a real app you'd namespace by user/session)
let memorySummary = "";       // the running “long-term” summary
let recentTurns   = [];       // array of { role: "user"|"assistant", content: string }

// Rough token estimate based on words (for demo)
function estimateTokens(text) {
  const words = text.split(/\s+/).length;
  return Math.ceil(words * 1.2);
}

// Build the summarization prompt for LLaMA
function buildSummarizationPrompt(existingSummary, recentTurns) {
  const recentText = recentTurns
    .map(t => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n");

  return `
You are a **Conversation Memory Assistant**.
Your job is to keep an **up‐to‐date running summary** of a user’s chat without losing details or inventing information.

**Rules:**
1. ONLY include facts, preferences, or decisions that appear verbatim in the conversation below.
2. Do NOT hallucinate or infer anything not explicitly stated.
3. Preserve all named entities (names, places, dates, numbers, preferences).
4. Keep the summary concise—use bullet points—but comprehensive.
5. Clearly append new facts and carry forward old facts unchanged.

Existing Summary:
${existingSummary || "[none]"}

New Messages:
${recentText}

Produce exactly:

Updated Summary:
- First bullet...
- Second bullet...
...
`.trim();
}

// Call your internal LLaMA service to get an updated summary
async function updateSummaryWithLlama() {
  const prompt = buildSummarizationPrompt(memorySummary, recentTurns);
  const resp = await fetch(LLAMA_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, max_tokens: 512 }),
  });
  if (!resp.ok) {
    console.error("LLaMA error", await resp.text());
    throw new Error("LLaMA summarization failed");
  }
  const { text } = await resp.json();          // assume { text: "Updated Summary:\n- ..." }
  // Extract lines after "Updated Summary:"
  const lines = text
    .split("\n")
    .filter(line => line.trim().startsWith("-"))
    .map(line => line.replace(/^- */, "").trim());
  // Rebuild the summary as bullet list
  memorySummary = lines.map(l => `- ${l}`).join("\n");
  recentTurns = [];  // reset recent window
}

// The main chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    if (!userMessage) return res.status(400).json({ error: "message is required" });

    // 1) Add user message to recentTurns
    recentTurns.push({ role: "user", content: userMessage });

    // 2) Check if we need to re-summarize
    const totalText = memorySummary + "\n" + recentTurns.map(t => t.content).join(" ");
    if (estimateTokens(totalText) > TOKEN_LIMIT) {
      await updateSummaryWithLlama();
    }

    // 3) Build the final prompt for OpenAI
    const messages = [
      { role: "system", content: "You are a helpful travel assistant." },
      ...(memorySummary
        ? [{ role: "system", content: `Conversation summary:\n${memorySummary}` }]
        : []),
      ...recentTurns.map(t => ({ role: t.role, content: t.content })),
    ];

    // 4) Call OpenAI Chat Completion
    const chatRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });
    const assistantReply = chatRes.choices[0].message.content;

    // 5) Append assistant reply
    recentTurns.push({ role: "assistant", content: assistantReply });

    // 6) Return to client
    res.json({ reply: assistantReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Chat server listening on http://localhost:${PORT}`);
});
