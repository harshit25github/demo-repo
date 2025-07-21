'use client';

import { useState } from 'react';

export default function Chat() {
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleStream = async () => {
    setIsLoading(true);
    setResponse('');

    const res = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Tell me a joke' }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const reader = res.body?.getReader();
    const decoder = new TextDecoder('utf-8');

    if (!reader) {
      setIsLoading(false);
      return;
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      setResponse(prev => prev + chunk); // Append the streamed text
    }

    setIsLoading(false);
  };

  return (
    <div className="p-4">
      <button
        onClick={handleStream}
        disabled={isLoading}
        className="px-4 py-2 bg-blue-600 text-white rounded"
      >
        {isLoading ? 'Streaming...' : 'Ask LLM'}
      </button>

      <pre className="mt-4 p-2 bg-gray-100 rounded text-sm whitespace-pre-wrap">
        {response}
      </pre>
    </div>
  );
}
