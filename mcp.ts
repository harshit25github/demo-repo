// server.mjs (ESM) or server.js with "type":"module" in package.json
import express from "express";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/mcp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Adjust these to your layout **/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ENTRY = path.resolve(__dirname, "../mcp-server/dist/index.js"); // <-- your built MCP server

const app = express();
app.use(express.json());

// Build the stdio transport that spawns your MCP server process
async function makeClient() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      // REQUIRED by your MCP server (from the code you pasted)
      SERVER_NAME: "localhost",            // or "host\\INSTANCE" or "host,1433"
      DATABASE_NAME: "YourDb",
      TRUST_SERVER_CERTIFICATE: "true",    // dev convenience
      READONLY: "true",                    // or "false" to enable write tools
      CONNECTION_TIMEOUT: "30",

      // No SQL user/pass here because your server uses InteractiveBrowserCredential.
      // At first run, it will pop a browser sign-in for Azure AD to get a token.
      // If you want SQL auth instead, see the note at the end.
    },
  });

  const client = new McpClient({ transport });
  await client.connect();
  return client;
}

/** Helpers to find tools by their advertised name (case-insensitive) */
async function findTool(client, nameOrIncludes) {
  const { tools } = await client.listTools();
  const lc = (s) => s.toLowerCase();

  // Exact match first
  let tool = tools.find(t => lc(t.name) === lc(nameOrIncludes));
  if (tool) return tool;

  // Fuzzy includes (e.g., "describe table")
  const parts = Array.isArray(nameOrIncludes) ? nameOrIncludes.map(lc) : [lc(nameOrIncludes)];
  tool = tools.find(t => parts.every(p => lc(t.name).includes(p)));
  return tool || null;
}

/** 1) List Tools: see what your server exposes */
app.get("/mcp/tools", async (req, res) => {
  try {
    const client = await makeClient();
    const { tools } = await client.listTools();
    await client.close();
    res.json(tools);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "listTools failed" });
  }
});

/** 2) Describe Table: calls your server's DescribeTable tool */
app.get("/mcp/describe/:table", async (req, res) => {
  try {
    const client = await makeClient();
    // Your server requires { tableName: string }
    const tool = await findTool(client, ["describe", "table"]);  // e.g., "describe_table"
    if (!tool) throw new Error("Describe Table tool not found");

    const result = await client.callTool({
      name: tool.name,
      arguments: { tableName: req.params.table }
    });

    await client.close();

    // Server returns text content with JSON stringified payload
    const text = result.content.filter(p => p.type === "text").map(p => p.text).join("\n");
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    res.json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "describeTable failed" });
  }
});

/** 3) Read Data: calls your server's ReadData tool
 *    We don't know exact arg schema of ReadDataTool; common patterns are:
 *    { tableName, columns?, where?, top? }.
 *    Pass through req.body to the tool so you can experiment.
 */
app.post("/mcp/read", async (req, res) => {
  try {
    const client = await makeClient();
    const tool = await findTool(client, ["read", "data"]);  // e.g., "read_data"
    if (!tool) throw new Error("Read Data tool not found");

    const result = await client.callTool({
      name: tool.name,
      arguments: req.body || {}
    });

    await client.close();

    const text = result.content.filter(p => p.type === "text").map(p => p.text).join("\n");
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    res.json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "readData failed" });
  }
});

/** 4) Generic tool invoker: name + arguments passthrough */
app.post("/mcp/call", async (req, res) => {
  try {
    const { name, args } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });

    const client = await makeClient();
    // You can either trust the name directly or resolve via listTools first:
    const tool = await findTool(client, name);
    const toolName = tool ? tool.name : name;

    const result = await client.callTool({
      name: toolName,
      arguments: args || {}
    });

    await client.close();

    const text = result.content.filter(p => p.type === "text").map(p => p.text).join("\n");
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    res.json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "callTool failed" });
  }
});

app.listen(5000, () => {
  console.log("Express listening on http://localhost:5000");
});

