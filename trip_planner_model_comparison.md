# Trip Planner Agent — Model Comparison (GPT-4.1 vs GPT-5.1 vs GPT-5.2)
_Date: 2025-12-23 (Asia/Kolkata)_

This note is written to help us **pick one primary model** (and optionally a fallback) for our Trip Planner Agent.
It focuses on what managers usually care about: **reliability, consistency, cost, and rollout risk**.

---

## 1) What “reliability” means for our Trip Planner
When we say “4.1 misses 10–20% of the time”, it usually shows up in 4 buckets:

1. **Tool-calling reliability**: does it consistently call webSearch / other tools when needed?
2. **Constraint adherence**: does it respect dates, budget, preferences, “don’t do X” rules?
3. **Structured output correctness**: does it return valid JSON / schema / consistent itinerary format?
4. **Long-horizon planning**: multi-city tradeoffs, revisions, and “keep the plan consistent” across turns.

A model upgrade can improve these, but the **biggest reliability gains** usually come from:
- strict structured outputs + schema validation,
- explicit tool-call gating rules,
- and a lightweight retry/self-check when the first attempt violates the schema.

---

## 2) Raw “spec + price” comparison (data you can cite)
All pricing below is **per 1M tokens**.

| Model | Positioning | Context window | Max output tokens | Knowledge cutoff | Input | Cached input | Output |
|---|---|---:|---:|---|---:|---:|---:|
| **GPT-4.1** | Non-reasoning; strong instruction-following + tool calling; low latency | **1,047,576** | **32,768** | **Jun 01, 2024** | **$2.00** | **$0.50** | **$8.00** |
| **GPT-5.1** | Flagship for coding/agentic tasks; configurable reasoning effort | **400,000** | **128,000** | **Sep 30, 2024** | **$1.25** | **$0.125** | **$10.00** |
| **GPT-5.2** | Flagship for coding + agentic tasks (latest); reasoning support | **400,000** | **128,000** | **Aug 31, 2025** | **$1.75** | **$0.175** | **$14.00** |

**Sources**
- GPT-4.1 model spec (context/max output/cutoff + positioning): https://platform.openai.com/docs/models/gpt-4.1  
- GPT-5.1 model spec: https://platform.openai.com/docs/models/gpt-5.1  
- GPT-5.2 model spec: https://platform.openai.com/docs/models/gpt-5.2  
- Official pricing table: https://platform.openai.com/docs/pricing

---

## 3) What the numbers imply (manager-friendly interpretation)

### A) If you care most about “never forget context”
- **GPT-4.1 wins** on raw context: ~**1M tokens**.
- This matters if you feed **big retrieval chunks**, long trip history, or lots of policy text into a single call.

### B) If you care most about “agentic success + complex multi-step”
- **GPT-5.1** and **GPT-5.2** are built for **agentic reasoning** and multi-step tasks.
- OpenAI positions **GPT-5.2** as the flagship for agentic tasks and reports strong results on agentic evals.  
  Source: https://openai.com/index/introducing-gpt-5-2/

### C) If you care most about cost
- For **short outputs**, GPT-5.1 is often the best cost/performance balance.
- For **long itinerary outputs**, GPT-4.1 can be cheaper than 5.1/5.2 because its **output** price is lower ($8 vs $10 vs $14).

### D) Cached input matters a lot (prompt caching)
If you reuse a large system prompt / policies across calls, prompt caching can reduce costs.
OpenAI describes prompt caching here: https://platform.openai.com/docs/guides/prompt-caching

---

## 4) Simple cost example (so everyone can “feel” it)
Assume one request uses:
- **Input** = 10,000 tokens  
- **Output** = 2,000 tokens  
(ignoring caching for simplicity)

Estimated cost:
- **GPT-4.1**: (10k/1M)*$2.00 + (2k/1M)*$8.00 = **$0.020 + $0.016 = $0.036**
- **GPT-5.1**: (10k/1M)*$1.25 + (2k/1M)*$10.00 = **$0.0125 + $0.020 = $0.0325**
- **GPT-5.2**: (10k/1M)*$1.75 + (2k/1M)*$14.00 = **$0.0175 + $0.028 = $0.0455**

**Takeaway:** if outputs are large, **5.2 becomes expensive faster**.

---

## 5) Recommendation for our Trip Planner (pragmatic)
### Default choice (most balanced)
**Pick GPT-5.1 as the primary model.**
- It’s positioned as the main flagship model for agentic/coding tasks with configurable reasoning.
- Pricing is also competitive on input.

### Optional “high-stakes fallback”
Use **GPT-5.2 only for difficult requests**, e.g.:
- multi-city + many constraints,
- “must not miss anything” flows,
- complex back-and-forth refinement.

### Keep GPT-4.1 for specific strengths
Use GPT-4.1 when:
- you need **very large context** (huge retrieval + long conversation),
- you want **low latency non-reasoning** behavior,
- you generate **long outputs** and want cheaper output tokens.

---

## 6) How we prove reliability improvements (what to measure)
To decide objectively (and convince management), run a small evaluation and report:

1. **Tool-call precision/recall**
   - % times tool is called when it should be
   - % times tool is NOT called when it shouldn’t be

2. **Schema pass rate**
   - % responses that validate without retry

3. **Constraint adherence score**
   - date correctness, budget correctness, preference correctness

4. **User experience**
   - manual rating or success/failure labels on ~50–200 real cases

### Rollout plan
- Start 10% traffic on GPT-5.1 → compare metrics vs GPT-4.1
- Add GPT-5.2 fallback only for “hard” requests (rule-based trigger)
- Keep a “retry with self-check” layer regardless of model (this usually cuts the 10–20% misses)

---

## 7) TL;DR (one slide)
- **GPT-5.1** = best default for agentic trip planning (balance of cost + reasoning).
- **GPT-5.2** = best for hardest agentic cases, but most expensive (especially outputs).
- **GPT-4.1** = excellent tool-calling + massive context + cheaper outputs; great when you pack lots of context or produce long itineraries.

