// 1. Install the MSSQL MCP Server
// npm install @azure/mssql-mcp-server

// 2. Create MCP Server Configuration (mcp-config.json)

// agent.mjs
import express from "express";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/mcp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import ollama from "ollama"; // npm i ollama

const MCP_URL   = process.env.MSSQL_MCP_URL || "http://localhost:3333/mcp";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1"; // tool-capable
const PORT = process.env.PORT || 5000;

const app = express();
app.use(express.json());

// ---------- 1) Connect to MCP (SSE) and cache tool metadata ----------
let mcp;
let mcpTools = [];   // [{ name, description, inputSchema }, ...]
async function getMcp() {
  if (mcp) return mcp;
  const client = new McpClient({ name: "express-ollama-bridge", version: "1.0.0" });
  await client.connect(new SSEClientTransport(new URL(MCP_URL)));
  mcp = client;

  const { tools } = await mcp.listTools();
  mcpTools = tools || [];
  return mcp;
}

// Convert MCP tool schema → Ollama tool schema (OpenAI-like)
function toOllamaTools(tools) {
  return (tools || []).map(t => {
    // MCP gives JSON Schema in t.inputSchema (if present)
    const parameters = t.inputSchema?.schema || t.inputSchema || {
      type: "object",
      properties: {},
      additionalProperties: true
    };
    return {
      type: "function",
      function: {
        name: t.name,                // keep original MCP name
        description: t.description || "MCP tool",
        parameters                    // JSON Schema
      }
    };
  });
}

// ---------- 2) The agent loop: Ollama ⇄ MCP tools ----------
async function runWithTools(question) {
  await getMcp();

  // Prepare tool list for Ollama
  const tools = toOllamaTools(mcpTools);

  // Conversation state (OpenAI-like messages format works with Ollama)
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful assistant. Use tools to answer questions about a Microsoft SQL Server database. " +
        "If you need data, call the appropriate tool with correct JSON args. When done, reply to the user."
    },
    { role: "user", content: question }
  ];

  // Loop: ask Ollama → if tool_calls, execute via MCP → append tool responses → ask again
  for (let step = 0; step < 8; step++) {
    const resp = await ollama.chat({
      model: OLLAMA_MODEL,
      messages,
      tools,               // <<< advertise tools to the model
      stream: false
    });

    const msg = resp.message || resp; // shape varies slightly by sdk
    // If model wants to call tools, you’ll see msg.tool_calls (array)
    const toolCalls = msg.tool_calls || msg.toolCalls || [];
    if (!toolCalls.length) {
      // No more tool calls → final answer
      return { final: msg.content };
    }

    // Execute each requested tool via MCP and add tool results
    for (const tc of toolCalls) {
      const toolName = tc.function?.name || tc.name;
      const rawArgs  = tc.function?.arguments ?? tc.arguments ?? "{}";

      // Parse args (Ollama sends a JSON string often)
      let argsObj = {};
      try {
        argsObj = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
      } catch {
        argsObj = {};
      }

      // Call the MCP tool
      const result = await mcp.callTool({ name: toolName, arguments: argsObj });

      // The MCP server usually returns text parts with stringified JSON
      const text = (result.content || [])
        .filter(p => p.type === "text")
        .map(p => p.text)
        .join("\n");

      // Feed the tool result back to the model as a "tool" role message
      messages.push({
        role: "tool",
        tool_call_id: tc.id || undefined, // if provided
        name: toolName,
        content: text || "(no result)"
      });
    }

    // Also include the assistant’s “tool call request” message in the history
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });
  }

  return { final: "I ran out of steps. Try rephrasing your question." };
}

// ---------- 3) REST endpoint ----------
app.post("/ask", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "question is required" });
    const out = await runWithTools(question);
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "failed" });
  }
});

app.get("/tools", async (_req, res) => {
  try {
    await getMcp();
    res.json(mcpTools);
  } catch (e) {
    res.status(500).json({ error: e.message || "listTools failed" });
  }
});

app.listen(PORT, () => console.log(`Agent on http://localhost:${PORT}`));

{
  "mcpServers": {
    "mssql": {
      "command": "node",
      "args": ["node_modules/@azure/mssql-mcp-server/dist/index.js"],
      "env": {
        "MSSQL_CONNECTION_STRING": "Server=localhost;Database=YourDatabase;User Id=youruser;Password=yourpassword;TrustServerCertificate=true"
      }
    }
  }
}

// 3. Alternative: Direct SQL Server Authentication Configuration
import { MSSQLMCPServer } from '@azure/mssql-mcp-server';

const server = new MSSQLMCPServer({
  server: 'localhost', // or your SQL Server instance
  database: 'YourDatabase',
  authentication: {
    type: 'sql-server', // Use SQL Server authentication
    options: {
      userName: 'your_username',
      password: 'your_password'
    }
  },
  // Optional: Connection options
  options: {
    encrypt: false, // Set to true if using SSL
    trustServerCertificate: true, // For local development
    connectionTimeout: 30000,
    requestTimeout: 30000
  }
});

// 4. Express Client Server Integration
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

const app = express();
app.use(express.json());

class MCPClient {
  private client: Client;
  private transport: StdioClientTransport;

  async initialize() {
    // Start the MCP server process
    const serverProcess = spawn('node', [
      'node_modules/@azure/mssql-mcp-server/dist/index.js'
    ], {
      env: {
        ...process.env,
        MSSQL_CONNECTION_STRING: "Server=localhost;Database=YourDatabase;User Id=youruser;Password=yourpassword;TrustServerCertificate=true"
      }
    });

    // Create transport and client
    this.transport = new StdioClientTransport({
      stdin: serverProcess.stdin!,
      stdout: serverProcess.stdout!,
      stderr: serverProcess.stderr!
    });

    this.client = new Client({
      name: "express-mcp-client",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });

    await this.client.connect(this.transport);
    console.log('MCP Client connected to MSSQL server');
  }

  async listTools() {
    const response = await this.client.listTools();
    return response.tools;
  }

  async callTool(name: string, args: any) {
    const response = await this.client.callTool({
      name,
      arguments: args
    });
    return response;
  }

  async disconnect() {
    await this.client.close();
  }
}

// Initialize MCP client
const mcpClient = new MCPClient();

app.post('/api/initialize-mcp', async (req, res) => {
  try {
    await mcpClient.initialize();
    res.json({ success: true, message: 'MCP client initialized' });
  } catch (error) {
    console.error('Failed to initialize MCP client:', error);
    res.status(500).json({ error: 'Failed to initialize MCP client' });
  }
});

app.get('/api/tools', async (req, res) => {
  try {
    const tools = await mcpClient.listTools();
    res.json({ tools });
  } catch (error) {
    console.error('Failed to list tools:', error);
    res.status(500).json({ error: 'Failed to list tools' });
  }
});

app.post('/api/execute-tool', async (req, res) => {
  try {
    const { toolName, args } = req.body;
    const result = await mcpClient.callTool(toolName, args);
    res.json({ result });
  } catch (error) {
    console.error('Failed to execute tool:', error);
    res.status(500).json({ error: 'Failed to execute tool' });
  }
});

// LLM Integration endpoint
app.post('/api/llm-query', async (req, res) => {
  try {
    const { query, useTools = true } = req.body;
    
    let availableTools = [];
    if (useTools) {
      availableTools = await mcpClient.listTools();
    }

    // Here you would integrate with your LLM (OpenAI, etc.)
    // Example with OpenAI:
    /*
    import OpenAI from 'openai';
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You have access to the following SQL tools: ${JSON.stringify(availableTools, null, 2)}`
        },
        {
          role: "user", 
          content: query
        }
      ],
      tools: availableTools.map(tool => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }))
    });

    // Handle tool calls if LLM wants to use them
    if (response.choices[0].message.tool_calls) {
      const toolResults = [];
      for (const toolCall of response.choices[0].message.tool_calls) {
        const result = await mcpClient.callTool(
          toolCall.function.name,
          JSON.parse(toolCall.function.arguments)
        );
        toolResults.push(result);
      }
      
      res.json({
        llmResponse: response.choices[0].message.content,
        toolResults
      });
    } else {
      res.json({
        llmResponse: response.choices[0].message.content
      });
    }
    */

    // Placeholder response for now
    res.json({
      query,
      availableTools,
      message: "LLM integration placeholder - implement your LLM logic here"
    });

  } catch (error) {
    console.error('Failed to process LLM query:', error);
    res.status(500).json({ error: 'Failed to process LLM query' });
  }
});

app.listen(3000, () => {
  console.log('Express server running on port 3000');
});

// 5. Environment variables (.env file)
/*
MSSQL_SERVER=localhost
MSSQL_DATABASE=YourDatabase  
MSSQL_USERNAME=your_username
MSSQL_PASSWORD=your_password
OPENAI_API_KEY=your_openai_key
*/

// 6. Package.json dependencies
/*
{
  "dependencies": {
    "@azure/mssql-mcp-server": "latest",
    "@modelcontextprotocol/sdk": "latest", 
    "express": "^4.18.0",
    "openai": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
*/
