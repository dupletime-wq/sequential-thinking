import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Sequential Thinking Core Logic
class SequentialThinkingServer {
  private thoughtHistory: Array<{
    thought: string;
    thoughtNumber: number;
    totalThoughts: number;
    nextThoughtNeeded: boolean;
  }> = [];

  public processThought(input: any) {
    const thoughtData = {
      thought: input.thought,
      thoughtNumber: input.thoughtNumber,
      totalThoughts: input.totalThoughts,
      nextThoughtNeeded: input.nextThoughtNeeded,
    };
    this.thoughtHistory.push(thoughtData);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            thoughtNumber: thoughtData.thoughtNumber,
            totalThoughts: thoughtData.totalThoughts,
            nextThoughtNeeded: thoughtData.nextThoughtNeeded,
            historyLength: this.thoughtHistory.length,
          }, null, 2),
        },
      ],
    };
  }
}

// Global active SSE transports map
const transports = new Map<string, SSEServerTransport>();

function createMcpServer() {
  const server = new Server(
    { name: "sequential-thinking-server", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  const thinkingLogic = new SequentialThinkingServer();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "sequentialthinking",
        description: "A tool for dynamic and reflective problem-solving through sequential thoughts.",
        inputSchema: {
          type: "object",
          properties: {
            thought: { type: "string", description: "Your current thinking step" },
            nextThoughtNeeded: { type: "boolean", description: "Whether another thought step is needed" },
            thoughtNumber: { type: "integer", description: "Current thought number", minimum: 1 },
            totalThoughts: { type: "integer", description: "Estimated total thoughts needed", minimum: 1 },
          },
          required: ["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "sequentialthinking") {
      return thinkingLogic.processThought(request.params.arguments);
    }
    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  return server;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. Establish SSE Connection
    if (url.pathname === "/sse") {
      const transport = new SSEServerTransport("/messages", new Response());
      const server = createMcpServer();
      
      // Save session transport
      transports.set(transport.sessionId, transport);

      const response = await transport.start();
      return response;
    }

    // 2. Handle Incoming Messages from Client
    if (url.pathname === "/messages" && request.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId || !transports.has(sessionId)) {
        return new Response("Session not found", { status: 404 });
      }

      const transport = transports.get(sessionId)!;
      await transport.handlePostMessage(request);
      return new Response("Accepted", { status: 202 });
    }

    return new Response("MCP Sequential Thinking Server Running", { status: 200 });
  },
};
