```markdown
Remove citations and source URLs from Policy Agent responses.

Scope:
- Update only Policy Agent response/prompt/output formatting.
- Do not modify unrelated agents or UI.

Issue:
Policy Agent uses a retrieval tool and sometimes returns responses with references like:
- `[1]`
- `[2]`
- `[3]`

And at the end it adds source URLs like:
- `[1] https://...`
- `[2] https://...`

We do not want references or links in the final Policy Agent response.

Required behavior:
- Policy Agent can still use retrieved chunks internally.
- Final user-facing response must not include:
  - square bracket citations like `[1]`, `[2]`
  - source/reference section
  - raw URLs
  - markdown links
  - “URL 1”, “Source 1”, etc.
- Answer should be clean, natural, and link-free.

Update Policy Agent prompt:
- Use retrieval content to answer.
- Do not expose citations, references, source numbers, or URLs.
- Do not append source list at the end.
- If source metadata exists, ignore it in the final response.

Add final sanitizer if needed:
- Remove `[1]`, `[2]`, etc.
- Remove raw URLs.
- Remove markdown links.
- Remove trailing source/reference blocks.

Tests:
1. Retrieved chunks contain URLs → final response has no URLs.
2. Agent tries `[1]` citations → final response removes them.
3. Multiple retrieved sources → final answer remains clean.
4. No placeholder like `URL 1` or `Source 1`.

Deliverable:
- Update Policy Agent prompt/formatting.
- Add sanitizer if prompt-only is not reliable.
- Share before/after examples.
```
