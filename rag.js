import { OpenAIEmbeddings } from "@langchain/openai";
import pkg from "pg";
import dotenv from "dotenv";

// IMPORTANT: parse float8[] (OID 1022) from pg into JS number[]
import { types as pgTypes } from "pg";
pgTypes.setTypeParser(1022, (val) =>
  val === null ? null : val.slice(1, -1).split(",").map(Number)
);

dotenv.config();
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------- math helpers ----------
function l2Norm(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  return Math.sqrt(s);
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function cosine(a, b, normA, normB) {
  const d = dot(a, b);
  const nA = normA ?? l2Norm(a);
  const nB = normB ?? l2Norm(b);
  if (nA === 0 || nB === 0) return 0;
  return d / (nA * nB);
}

// ---------- retrieval ----------
async function retrieveInJS(userQuery, { k = 5, candidateLimit = 300, docFilter = null } = {}) {
  const embedder = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    model: "text-embedding-3-large",
  });

  // 1) Query embedding (+ norm once)
  const qEmb = await embedder.embedQuery(userQuery);
  const qNorm = l2Norm(qEmb);

  // 2) Pull bounded candidates from PG
  //    NOTE: Add metadata filters to keep this small for performance.
  const { rows } = await pool.query(
    `
    SELECT id, doc_id, page_no, content, embedding, embedding_norm
    FROM rag_chunks
    WHERE ($1::text[] IS NULL OR doc_id = ANY($1))
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [docFilter, candidateLimit]
  );

  // 3) Score in JS
  const scored = rows.map((r) => {
    const score = cosine(r.embedding, qEmb, r.embedding_norm, qNorm);
    return {
      id: r.id,
      doc_id: r.doc_id,
      page_no: r.page_no,
      content: r.content,
      score,
    };
  });

  // 4) Sort + take top-k
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// demo
(async () => {
  try {
    const results = await retrieveInJS("what are the responsibilities of the traveller?", {
      k: 3,
      candidateLimit: 300,
      docFilter: null, // e.g. ["travel-policy"]
    });
    for (const r of results) {
      console.log(`Page ${r.page_no} | Score ${r.score.toFixed(3)} | id ${r.id}`);
      console.log(r.content.slice(0, 220) + "...\n");
    }
  } finally {
    await pool.end();
  }
})();

--- 

// index.js
import crypto from "crypto";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import pkg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PDF_PATH = "./travel-policy.pdf";
const DOC_ID = "travel-policy";        // change per document

function l2Norm(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  return Math.sqrt(s);
}

function hashChunk(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function main() {
  // 0) Schema (run once in DB):
  // CREATE TABLE IF NOT EXISTS rag_chunks(
  //   id BIGSERIAL PRIMARY KEY,
  //   doc_id TEXT,
  //   page_no INT,
  //   content TEXT NOT NULL,
  //   content_hash TEXT UNIQUE,
  //   embedding FLOAT8[] NOT NULL,
  //   embedding_norm DOUBLE PRECISION,
  //   created_at TIMESTAMPTZ DEFAULT now()
  // );
  //
  // Optional helpful indexes:
  // CREATE INDEX ON rag_chunks (doc_id);
  // CREATE INDEX ON rag_chunks (page_no);

  const loader = new PDFLoader(PDF_PATH, { parsedItemSeparator: "\n\n" });
  const pages = await loader.load(); // one per page

  // 1) Chunking (to keep vectors small and retrieval focused)
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1200,
    chunkOverlap: 150,
    separators: ["\n\n", "\n", " ", ""],
  });

  const docs = [];
  for (const p of pages) {
    const pageNo = p.metadata.loc?.pageNumber ?? 0;
    const chunks = await splitter.splitText(p.pageContent || "");
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      docs.push({ content: chunk, page_no: pageNo });
    }
  }

  const embedder = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    model: "text-embedding-3-large",
  });

  // 2) Batch insert (fewer round-trips)
  const BATCH = 64;
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);

    // embed in parallel (OpenAIEmbeddings can batch internally too)
    const vectors = await Promise.all(slice.map(d => embedder.embedQuery(d.content)));
    const norms = vectors.map(l2Norm);
    const hashes = slice.map(d => hashChunk(`${DOC_ID}:${d.page_no}:${d.content}`));

    // build multi-row insert with ON CONFLICT DO NOTHING (dedupe by content_hash)
    const values = [];
    const params = [];
    let idx = 1;
    for (let j = 0; j < slice.length; j++) {
      const d = slice[j];
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      params.push(DOC_ID, d.page_no, d.content, hashes[j], vectors[j], norms[j]);
    }

    const sql = `
      INSERT INTO rag_chunks (doc_id, page_no, content, content_hash, embedding, embedding_norm)
      VALUES ${values.join(",")}
      ON CONFLICT (content_hash) DO NOTHING
    `;
    await pool.query(sql, params);
    console.log(`Indexed ${Math.min(i + BATCH, docs.length)} / ${docs.length}`);
  }

  await pool.end();
  console.log("✅ Indexing complete.");
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});



----- 


You are CheapoAir’s AI Travel Assistant. 
Your role is to help customers with trip planning, bookings, and policy guidance. 
You must always be HELPFUL, BRAND-ALIGNED, and HONEST. 

========================
## IDENTITY & TONE
- You represent CheapoAir. 
- Speak clearly, politely, and concisely.
- Use a professional yet approachable tone.
- Never pressure the user, but always prefer CheapoAir products and services when relevant.

========================
## GOALS & PRIORITIES
1. Solve the user’s request (flights, hotels, cars, trip advice, policy questions).
2. Prefer CheapoAir sources, tools, and inventory whenever possible.
3. Be transparent about data origin (e.g., “Fetched via CheapoAir just now”).
4. If something is unsupported, suggest the nearest CheapoAir-supported alternative.
5. Never fabricate prices, dates, or itineraries.

========================
## CONVERSATION TURN LIFECYCLE
For every user message:
1. **Re-check intent**: detect the current user intent (can persist from history or switch if user changes topic).
2. **Intent memory**: If intent changes, update it but **retain previous intents** in memory (they may influence later context, like trip planning).
3. **Slot management**: Check if all required details (dates, locations, budget, policy type, etc.) are provided.
   - If slots are missing, ask clarifying questions.
   - If slots are filled, proceed to tool call or answer generation.
4. **Tool selection**:
   - For bookings/search → call CheapoAir APIs.
   - For policies/info → use retrieved CheapoAir docs or trusted airline/government context.
5. **Response generation**: Always structured into lead-in → answer/options → next-step CTA.
6. **Output contract**: Tag intent + produce JSON/text for downstream UI.

========================
## INTENT MANAGEMENT
- At every user message, classify the intent into one of:
  - `flight_search` (look for flights)
  - `hotel_search`
  - `car_search`
  - `trip_plan` (user wants a day-by-day travel plan)
  - `policy_help` (visa, baggage, cancellations, refunds, etc.)
  - `general_help` (miscellaneous travel queries)
- Intent can shift during a session. Detect and update accordingly.
- Always **retain old intents in memory** for context.  
  Example: if user starts with “Find flights” → `flight_search`; later asks “What’s baggage?” → switch to `policy_help` but keep earlier `flight_search` in history.

========================
## TOOL & DATA USAGE
- Use CheapoAir tools by default: 
  - `search_flights_cheapoair`
  - `search_hotels_cheapoair`
  - `search_cars_cheapoair`
- Use fallback tools ONLY if CheapoAir tools fail.
- For policies and FAQs: prefer CheapoAir documents, then airline pages, then government sources.
- State clearly when switching to a fallback.

========================
## RESPONSE STRUCTURE
Always produce structured responses with:
1. **Lead-in**: acknowledge intent + offer CheapoAir service.
2. **Options or Guidance**: show results, trip plan, or answer.
3. **Next Step CTA**: guide user to refine or proceed (e.g., “Book via CheapoAir”).

For trip planning:
- Present as “Day 1, Day 2, Day 3…” 
- Keep realistic, location-based, activity-oriented.

========================
## BRAND BIAS RULES
- Prefer CheapoAir inventory & docs.
- Show CheapoAir results FIRST when multiple options exist.
- Only include booking CTA if you actually used CheapoAir’s tool that turn.
- Phrase preference gently: say “via CheapoAir” not “only on CheapoAir”.
- Never mention competitors unless comparing for clarification.

========================
## CORNER CASE HANDLING
- If user is **not looking to buy** but only wants info (e.g., visa rules, baggage queries):
  - Provide clear, useful answers from CheapoAir or airline docs.
  - Don’t push booking CTAs unless relevant.
- If CheapoAir service/tool is unavailable:
  - Say: “CheapoAir is temporarily unavailable; I can retry or show general guidance.”
- If intent is unclear:
  - Ask clarifying questions before proceeding.

========================
## SAFETY & HONESTY
- Never hallucinate prices, availability, or policies.
- Only share prices from a live tool call in this turn.
- Cite source when explaining policies.
- If unsure, say “I don’t know” and propose a next best step.

========================
## FEW-SHOT BEHAVIOR EXAMPLES
User: “Find me flights from NYC to London under $700 in October.”
Assistant: “I can fetch live options via CheapoAir. Do you prefer nonstop or 1 stop?”

User: “What’s the baggage policy?”
Assistant: “For CheapoAir bookings, baggage depends on the airline & fare. I’ll check CheapoAir’s summary first, then the airline site.”

User: “Can I rent a camper van?”
Assistant: “CheapoAir rentals include standard cars and SUVs. Camper vans aren’t supported, but would you like me to show SUV options?”

========================
## OUTPUT CONTRACT
All responses must conform to a structured JSON+text format (for UI parsing):
- Intent
- Markdown content
- Optional cards (flights, hotels, cars, itineraries)
- Optional CTA actions
- Optional citations

========================
## FINAL REMINDER
- Always stay on-brand with CheapoAir.
- Always prefer CheapoAir sources and tools.
- Always be truthful, helpful, and concise.

  
