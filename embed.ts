// rerankExample.js
import dotenv from "dotenv";
import { Client } from "pg";
import OpenAI from "openai";
import PCA from "ml-pca";             // only if you need PCA elsewhere

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// simple cosine
function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function dualEncodeRetrieve(userInput, topK = 5) {
  // 1) embed the query
  const embedRes = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: userInput,
  });
  const userEmb = embedRes.data[0].embedding;

  // 2) fetch all prompts
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const { rows } = await pg.query(`
    SELECT id, prompt, embedding
    FROM system_prompts
  `);
  await pg.end();

  // 3) score & sort
  const scored = rows.map(r => ({
    id:         r.id,
    prompt:     r.prompt,
    score:      cosine(userEmb, r.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

async function crossEncoderRescore(userInput, candidates) {
  // We’ll ask the LLM to give us a numeric relevance score 0–1
  // Build one big prompt that asks for JSON with {id, score} array:
  const system = `
You are a relevance-scoring assistant.  
Given a user query and a list of candidate system-prompts, assign each prompt a relevance score between 0.0 (not relevant) and 1.0 (perfect match).  
Respond _only_ with a JSON array of objects: [{"id":..., "score":...}, …].
`;

  // build user message
  let content = `User Query:\n"${userInput}"\n\nCandidates:\n`;
  for (const c of candidates) {
    content += `\n[${c.id}] ${c.prompt}`;
  }

  const chatRes = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system.trim() },
      { role: "user",   content },
    ],
    temperature: 0,
  });

  // parse JSON
  const text = chatRes.choices[0].message.content.trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse cross-encoder output:", text);
    throw e;
  }
}

async function main() {
  const userInput = "I’m planning a surprise romantic weekend in Paris with candlelit dinners";
  console.log("User Input:", userInput);

  // 1️⃣ Dual-encoder: get top-5
  const top5 = await dualEncodeRetrieve(userInput, 5);
  console.log("\nTop-5 candidates by cosine:");
  top5.forEach(c => console.log(`  [${c.id}] score=${c.score.toFixed(3)} → ${c.prompt}`));

  // 2️⃣ Cross-encoder: re-score those 5
  const reranked = await crossEncoderRescore(userInput, top5);
  console.log("\nCross-encoder scores:");
  reranked.forEach(r => console.log(`  [${r.id}] score=${r.score}`));

  // 3️⃣ Find best
  const best = reranked.reduce((a, b) => (b.score > a.score ? b : a), reranked[0]);
  const chosen = top5.find(c => c.id === best.id);
  console.log("\n🏆 Final selection:");
  console.log(`  [${best.id}] score=${best.score} → ${chosen.prompt}`);
}

main().catch(console.error);

-------
// scripts/plotSystemPrompts.js
import fs   from "fs";
import path from "path";
import dotenv from "dotenv";
import { Client } from "pg";
import PCA  from "ml-pca";

dotenv.config();

async function main() {
  // 1) Connect and fetch embeddings
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const { rows } = await pg.query(`
    SELECT id, embedding 
      FROM system_prompts 
     ORDER BY id
  `);
  await pg.end();

  if (!rows.length) {
    console.error("No prompts found in the DB");
    process.exit(1);
  }

  // 2) Build data matrix
  const ids = rows.map(r => r.id);
  const X   = rows.map(r => r.embedding);

  // 3) Run PCA → 2 components
  const pca = new PCA(X);
  const coords = pca.predict(X, { nComponents: 2 }).to2DArray();

  // 4) Build an HTML page with Plotly
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>System-Prompt Embeddings PCA</title>
  <script src="https://cdn.plot.ly/plotly-2.30.0.min.js"></script>
</head>
<body>
  <div id="plot" style="width:800px;height:600px;"></div>
  <script>
    // Data from Node
    const ids = ${JSON.stringify(ids)};
    const coords = ${JSON.stringify(coords)};

    const x = coords.map(p => p[0]);
    const y = coords.map(p => p[1]);
    const labels = ids.map(id => id.toString());

    const trace = {
      x,
      y,
      mode: "markers+text",
      type: "scatter",
      text: labels,
      textposition: "top center",
      marker: { size: 10 }
    };

    const layout = {
      title: "System-Prompt Embeddings (PCA → 2D)",
      xaxis: {
        title: "PC1",
        zeroline: true,
        zerolinecolor: "#999"
      },
      yaxis: {
        title: "PC2",
        zeroline: true,
        zerolinecolor: "#999"
      }
    };

    Plotly.newPlot("plot", [trace], layout);
  </script>
</body>
</html>
`;

  // 5) Write out the HTML
  const outPath = path.resolve(process.cwd(), "system-prompts-pca.html");
  fs.writeFileSync(outPath, html, "utf8");
  console.log("✅ Written PCA visualization to", outPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


// scripts/loadSystemPrompts.js
// server.js
import express from "express";
import dotenv from "dotenv";
import { Client } from "pg";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Simple cosine-similarity
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

app.post("/system-prompt", async (req, res) => {
  const { userInput } = req.body;
  if (!userInput) {
    return res.status(400).json({ error: "userInput is required" });
  }

  try {
    // 1) Embed user message
    const embedRes = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: userInput,
    });
    const userEmb = embedRes.data[0].embedding;

    // 2) Fetch all prompts + embeddings from Postgres
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    const { rows } = await pg.query(`
      SELECT id, prompt, embedding
      FROM system_prompts
    `);
    await pg.end();

    if (rows.length === 0) {
      return res.json({ systemPrompt: null, similarity: 0 });
    }

    // 3) Find best match
    let best = rows[0];
    let bestScore = cosineSimilarity(userEmb, best.embedding);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const score = cosineSimilarity(userEmb, row.embedding);
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }

    // 4) Return it
    res.json({
      systemPrompt: best.prompt,
      similarity:   bestScore,
    });

  } catch (err) {
    console.error("Error in /system-prompt:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`> Listening on http://localhost:${port}`);
});
-------
import dotenv from "dotenv";
import { Client } from "pg";
import OpenAI from "openai";

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPTS = [
  "You are an expert travel planner with 10+ years of experience crafting detailed itineraries. Your recommendations are organized by day, balanced between must-see sights and hidden gems, and optimized for travel time and budget.",
  "You are a budget travel specialist. Your goal is to help travelers see the world for as little money as possible—identifying affordable lodging, cheap eats, free attractions, and money-saving tips on transport.",
  "You are a luxury travel concierge. Provide five-star hotel suggestions, fine-dining reservations, VIP tours, and exclusive experiences. Your recommendations should emphasize comfort, service quality, and exclusivity.",
  "You are an adventure-travel expert. Recommend adrenaline-pumping activities like hiking off-trail, white-water rafting, zip-lining, or scuba diving. Always include safety gear, local guide contacts, and difficulty levels.",
  "You are a cultural immersion specialist. Suggest authentic local experiences—home-cooked meals with locals, traditional craft workshops, community festivals, and language-exchange meetups.",
  "You are an eco-travel advisor. Recommend eco-friendly accommodations, carbon-offset transport options, responsible wildlife tours, and low-impact activities to help travelers minimize their footprint.",
  "You are a family trip planner. Create itineraries that are safe and engaging for both kids and adults—kid-friendly museums, amusement parks, family restaurants, and relaxed pacing with rest breaks.",
  "You are a solo-traveler guide focused on safety. Recommend well-lit neighborhoods, women-friendly accommodations if needed, reliable transport apps, and tips on staying connected and secure abroad.",
  "You are a culinary travel guide. Curate food-focused itineraries—street-food tours, top-rated local restaurants, cooking classes, and markets. Always note dietary accommodations and reservation tips.",
  "You are a flash-trip specialist. Help travelers book impromptu weekend getaways with last-minute flight/hotel deals, budget-friendly package offers, and flexible cancellation options.",
  "You are an off-the-beaten-path explorer. Recommend lesser-known towns, secluded natural attractions, and under-the-radar cultural sites where travelers can avoid crowds and experience authenticity.",
  "You are a business travel assistant. Focus on efficient itineraries near conference venues, reliable transport, quiet work-friendly cafés, and loyalty-program-friendly hotels.",
  "You are a digital-nomad expert. Suggest destinations with fast internet, co-working spaces, long-stay accommodations, and local visa/work-permit options for remote workers.",
  "You are a road-trip planner. Map out scenic driving routes, recommend day-stop attractions, rest areas, and best local diners along the way. Include estimated driving times and fuel/cost estimates.",
  "You are a romantic-getaway planner. Curate intimate experiences—sunset cruises, candlelit dinners, couples’ spa retreats, and cozy boutique hotels.",
];

async function main() {
  // 1) Connect to Postgres
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 2) Enable the pgvector extension (if not already)
  await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  // 3) Create our prompts table
  await client.query(`
    CREATE TABLE IF NOT EXISTS system_prompts (
      id        SERIAL PRIMARY KEY,
      prompt    TEXT       NOT NULL,
      embedding VECTOR(1536) NOT NULL
    );
  `);

  // 4) Embed & insert each prompt
  for (const promptText of SYSTEM_PROMPTS) {
    console.log("Embedding prompt:", promptText.slice(0, 60) + "…");

    // a) Call OpenAI to get the embedding
    const res = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: promptText,
    });
    const embedding = res.data[0].embedding;

    // b) Insert into Postgres
    await client.query(
      `INSERT INTO system_prompts(prompt, embedding) VALUES($1, $2)`,
      [promptText, embedding]
    );
  }

  console.log("✅ All prompts saved!");
  await client.end();
}

main().catch((err) => {
  console.error("Error loading prompts:", err);
  process.exit(1);
});
