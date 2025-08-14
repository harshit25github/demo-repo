// 1. Install the MSSQL MCP Server
// npm install @azure/mssql-mcp-server

// 2. Create MCP Server Configuration (mcp-config.json)
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
