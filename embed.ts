import OpenAI from "openai";

// If you want to use a .env file, uncomment:
// import dotenv from "dotenv";
// dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  console.error("Set OPENAI_API_KEY in your environment before running.");
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cosineSimilarity(a, b) {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return dot / (normA * normB);
}

async function main() {
  const a = "man bites dog";
  const b = "dog bites man";

  // request embeddings for each string
  const respA = await client.embeddings.create({
    model: "text-embedding-ada-002",
    input: a,
  });

  const respB = await client.embeddings.create({
    model: "text-embedding-ada-002",
    input: b,
  });

  // The embeddings are in resp.data[0].embedding
  const embA = respA.data[0].embedding;
  const embB = respB.data[0].embedding;

  console.log("embedding length:", embA.length);
  console.log("cosine similarity (a, b):", cosineSimilarity(embA, embB));
}

main().catch(err => {
  console.error("Error:", err);
});
