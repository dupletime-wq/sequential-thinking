// Cloudflare Workers entry point for the Sequential Thinking MCP server.
//
// This is a separate deployment target from index.ts (the stdio server that
// is published to npm and shipped in the Docker image). Keeping them apart
// means the Worker's Web-standard fetch handler never touches the package
// that npm/Docker consumers depend on.
//
// Caveat: SSE session state below is held in an in-memory Map, which only
// works while a single Worker isolate serves both the GET /sse stream and
// the follow-up POST /messages calls for that session. Cloudflare does not
// guarantee that; for a production deployment, back sessions with a
// Durable Object instead.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { SequentialThinkingServer, ThoughtData } from "./lib.js";

class WorkerSSEServerTransport implements Transport {
  sessionId: string;
  stream: ReadableStream;
  private controller?: ReadableStreamDefaultController;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    const transport = this;

    this.stream = new ReadableStream({
      start(controller) {
        transport.controller = controller;
        const endpointUrl = `/messages?sessionId=${transport.sessionId}`;
        const initEvent = `event: endpoint\ndata: ${endpointUrl}\n\n`;
        controller.enqueue(new TextEncoder().encode(initEvent));
      },
      cancel() {
        transport.onclose?.();
      },
    });
  }

  async start(): Promise<void> {}

  async handlePostMessage(message: JSONRPCMessage): Promise<void> {
    this.onmessage?.(message);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.controller) {
      throw new Error("Transport is not connected");
    }
    const sseEvent = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
    this.controller.enqueue(new TextEncoder().encode(sseEvent));
  }

  async close(): Promise<void> {
    this.controller?.close();
    this.onclose?.();
  }
}

const transports = new Map<string, WorkerSSEServerTransport>();

function createMcpServer() {
  const server = new Server(
    { name: "sequential-thinking-server", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  const thinkingServer = new SequentialThinkingServer();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "sequentialthinking",
        description:
          "A tool for dynamic and reflective problem-solving through sequential thoughts.",
        inputSchema: {
          type: "object",
          properties: {
            thought: { type: "string", description: "Your current thinking step" },
            nextThoughtNeeded: {
              type: "boolean",
              description: "Whether another thought step is needed",
            },
            thoughtNumber: {
              type: "integer",
              description: "Current thought number",
              minimum: 1,
            },
            totalThoughts: {
              type: "integer",
              description: "Estimated total thoughts needed",
              minimum: 1,
            },
            isRevision: { type: "boolean", description: "Whether this revises previous thinking" },
            revisesThought: { type: "integer", description: "Which thought is being reconsidered", minimum: 1 },
            branchFromThought: { type: "integer", description: "Branching point thought number", minimum: 1 },
            branchId: { type: "string", description: "Branch identifier" },
            needsMoreThoughts: { type: "boolean", description: "If more thoughts are needed" },
          },
          required: ["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "sequentialthinking") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    return thinkingServer.processThought(request.params.arguments as unknown as ThoughtData);
  });

  return server;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (url.pathname === "/sse") {
      const sessionId = crypto.randomUUID();
      const transport = new WorkerSSEServerTransport(sessionId);
      const server = createMcpServer();

      await server.connect(transport);
      await transport.start();
      transports.set(sessionId, transport);

      return new Response(transport.stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (url.pathname === "/messages" && request.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId || !transports.has(sessionId)) {
        return new Response("Session not found", { status: 404 });
      }

      const transport = transports.get(sessionId)!;
      const body = (await request.json()) as JSONRPCMessage;
      await transport.handlePostMessage(body);

      return new Response("Accepted", {
        status: 202,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    return new Response("MCP Sequential Thinking Server Running", { status: 200 });
  },
};
