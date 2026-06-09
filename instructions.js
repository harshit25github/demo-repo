```markdown
Fix the orchestrator/gateway routing logic for baggage-related queries.

Context:
- All requests first go to the orchestrator/gateway agent.
- Gateway routes queries to sub-agents:
  - Trip Planning Agent
  - Flight Agent
  - Listing Page Agent
  - Policy Agent
- Flight/Listing Agent supports flight filters, including baggage-related filters:
  - Personal item
  - Carry-on baggage
  - Checked baggage
- Policy Agent handles informational baggage policy questions from the knowledge base.

Problem:
Gateway sometimes routes baggage filter queries to the Policy Agent because it sees the word "baggage", but some baggage queries are actually flight/listing filter actions.

Required fix:
Update the gateway/orchestrator routing instructions so it can distinguish between:

1. Baggage filter intent → route to Flight/Listing Agent
   Examples:
   - "Show flights with checked baggage"
   - "Apply carry-on baggage filter"
   - "Only show flights with personal item included"
   - "Filter flights by checked bag"
   - "I want flights that include baggage"

2. Baggage policy/info intent → route to Policy Agent
   Examples:
   - "What is American Airlines baggage policy?"
   - "How much baggage is allowed?"
   - "Explain carry-on baggage rules"
   - "What is the checked bag fee?"

Expected behavior:
- If the user wants to apply/update/remove baggage filters on flight results, route to Flight/Listing Agent.
- If the user is asking for baggage rules, allowance, fees, airline policy, or explanation, route to Policy Agent.
- Do not route baggage filter actions to Policy Agent just because the word "baggage" is present.
- Add/update tests for both routing scenarios.
```
