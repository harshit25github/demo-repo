// chatServer.js
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

const chats = {}; // Your main store: { userId: { chatId: [messages] } }

app.post('/chat', async (req, res) => {
  const { userId = "1", prompt } = req.body;
  const chatId = uuidv4();

  // Streaming from Ollama
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3',
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let fullContent = '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  async function readStream() {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // 🧠 Stream finished, save chat now
        const message = {
          role: 'assistant',
          content: fullContent,
          messageId: uuidv4(),
          createdAt: new Date().toISOString(),
        };

        // Save in structure
        if (!chats[userId]) chats[userId] = {};
        chats[userId][chatId] = [message];

        console.log('✅ Chat saved:', chats);
        res.end(); // Close SSE stream
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        const trimmed = line.replace(/^data:\s*/, '');
        if (trimmed === '[DONE]') continue;

        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.message?.content) {
            const contentPiece = parsed.message.content;
            fullContent += contentPiece;

            res.write(`data: ${contentPiece}\n\n`);
          }
        } catch (e) {
          console.error('❌ JSON parse error:', e.message);
        }
      }
    }
  }

  readStream();
});

app.listen(3000, () => {
  console.log('🟢 Server running on http://localhost:3000');
});


-----------------------------------------------

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
