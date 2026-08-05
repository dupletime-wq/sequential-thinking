#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SequentialThinkingServer, registerSequentialThinkingTool } from './lib.js';

const server = new McpServer({
  name: "sequential-thinking-server",
  version: "0.2.0",
});

registerSequentialThinkingTool(server, new SequentialThinkingServer());

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sequential Thinking MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
