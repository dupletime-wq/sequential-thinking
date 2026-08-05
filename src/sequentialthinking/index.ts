import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";

// Cloudflare Workers (Web Standard) 전용 SSE Transport
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

  async start(): Promise<void> {
    // Transport 초기화 완료
  }

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
          text: JSON.stringify(
            {
              thoughtNumber: thoughtData.thoughtNumber,
              totalThoughts: thoughtData.totalThoughts,
              nextThoughtNeeded: thoughtData.nextThoughtNeeded,
              historyLength: this.thoughtHistory.length,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}

// 활성화된 세션 추적용 Map
const transports = new Map<string, WorkerSSEServerTransport>();

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
          },
          required: [
            "thought",
            "nextThoughtNeeded",
            "thoughtNumber",
            "totalThoughts",
          ],
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

// Cloudflare Workers Export Handler
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight 처리
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // 1. GET /sse : SSE 스트림 생성
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

    // 2. POST /messages : 클라이언트 요청 전달받음
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
