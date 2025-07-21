const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

router.get('/ollama-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const ollamaResponse = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3',
      messages: [{ role: 'user', content: 'Tell me a joke' }],
      stream: true,
    }),
  });

  const reader = ollamaResponse.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // handle complete JSON objects
    const lines = buffer.split('\n');
    buffer = lines.pop(); // last line might be incomplete

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const content = parsed.message?.content || '';
        res.write(`data: ${content}\n\n`);
      } catch (err) {
        console.error('Invalid JSON chunk:', line);
      }
    }
  }

  res.end();
});

module.exports = router;
