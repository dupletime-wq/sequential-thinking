// Cloudflare Workers entry point for the Sequential Thinking MCP server.
//
// Separate deployment target from index.ts (the stdio server published to
// npm and shipped in the Docker image) -- both call the same
// registerSequentialThinkingTool() from lib.ts, so the tool contract never
// drifts between transports.
//
// Exposes the current MCP transport, Streamable HTTP, at /mcp. The legacy
// two-endpoint HTTP+SSE transport (GET /sse + POST /messages) was
// deprecated by the MCP spec in March 2025; most clients, including
// Claude.ai custom connectors, expect a single /mcp endpoint. /sse is kept
// only for older clients that haven't migrated yet.
//
// McpAgent backs each session with a Durable Object, so thoughtHistory in
// SequentialThinkingServer correctly accumulates across the calls of one
// sequential-thinking session -- unlike a stateless handler, which would
// reset it on every request.
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SequentialThinkingServer, registerSequentialThinkingTool } from "./lib.js";

const BINDING = "SequentialThinkingMCP";

export class SequentialThinkingMCP extends McpAgent {
  server = new McpServer({ name: "sequential-thinking-server", version: "0.2.0" });

  async init() {
    registerSequentialThinkingTool(this.server, new SequentialThinkingServer());
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const corsOptions = { origin: "*" };

    if (url.pathname === "/mcp") {
      return SequentialThinkingMCP.serve("/mcp", { binding: BINDING, corsOptions }).fetch(request, env, ctx);
    }

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return SequentialThinkingMCP.serveSSE("/sse", { binding: BINDING, corsOptions }).fetch(request, env, ctx);
    }

    return new Response("MCP Sequential Thinking Server. Connect at /mcp (Streamable HTTP).", { status: 200 });
  },
};
