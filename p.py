Planned Improvements
1. Architecture Optimization
Remove duplicate database queries between Next.js and AI backend. Next.js will fetch data once and pass it to the AI backend, eliminating redundant work.
2. Parallel Tool Execution
Enable the AI agent to call multiple tools simultaneously instead of one-by-one. Independent tasks will run at the same time rather than waiting in sequence.
3. Database Separation of Concerns
Next.js handles all database operations; AI backend focuses only on AI processing. Add proper indexes and limit chat history to recent messages for faster queries.
4. Flight API Caching
Store recent flight search results in cache. Return cached results for duplicate searches instead of calling the API repeatedly.
5. Smart Context with Vector Store
Send last 10 messages plus relevant memories from vector database. AI gets recent context and important past information without processing all historical messages.
