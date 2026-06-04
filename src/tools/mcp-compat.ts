// ── In-process MCP server compat layer ──────────────────────────────
// Drop-in replacements for `tool()` and `createSdkMcpServer()` from
// @anthropic-ai/claude-agent-sdk, built directly on @modelcontextprotocol/sdk
// (already a dependency). Lets us keep every tool implementation byte-for-byte
// while removing the agent-sdk dependency.
//
// Also provides createMcpBridge(): a raw JSON-RPC passthrough that the direct
// CLI driver uses to answer `mcp_message` control_requests — the CLI sends
// complete JSON-RPC frames (initialize / tools/list / tools/call) for an
// advertised sdk server, and we route them to the in-process McpServer instance
// over an in-memory transport and return the JSON-RPC response.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ZodRawShape } from 'zod';

// CallToolResult mirrors the MCP tool result shape the tool handlers already return.
export type CallToolResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: string; [k: string]: unknown }
  >;
  isError?: boolean;
  [k: string]: unknown;
};

export type ToolAnnotations = Record<string, unknown>;

// Infer the parsed args object from a Zod raw shape (matches the agent-sdk's
// InferShape so tool handlers keep their typed `args`).
export type InferShape<T extends ZodRawShape> = {
  [K in keyof T]: T[K] extends { _output: infer O } ? O : never;
} & {};

export type SdkMcpToolDefinition<Schema extends ZodRawShape = ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: Schema;
  annotations?: ToolAnnotations;
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>;
};

/**
 * Define an in-process MCP tool. Signature matches the agent-sdk `tool()` so
 * tool files only need to swap the import path.
 */
export function tool<Schema extends ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations },
): SdkMcpToolDefinition<Schema> {
  return { name, description, inputSchema, handler, annotations: extras?.annotations };
}

export type McpSdkServerConfigWithInstance = {
  type: 'sdk';
  name: string;
  instance: McpServer;
};

export type CreateSdkMcpServerOptions = {
  name: string;
  version?: string;
  tools?: Array<SdkMcpToolDefinition<any>>;
};

/**
 * Build an in-process MCP server from tool definitions. Returns the same
 * {type:'sdk', name, instance} shape the agent-sdk produced, so callers
 * (agent.ts, ollama.ts) are unaffected.
 */
export function createSdkMcpServer(options: CreateSdkMcpServerOptions): McpSdkServerConfigWithInstance {
  const instance = new McpServer({ name: options.name, version: options.version ?? '1.0.0' });
  for (const t of options.tools ?? []) {
    instance.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.inputSchema as any,
        annotations: t.annotations as any,
      },
      t.handler as any,
    );
  }
  return { type: 'sdk', name: options.name, instance };
}

/** A raw JSON-RPC passthrough into an in-process MCP server. */
export type McpBridge = (message: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Connect an McpServer instance to an in-memory transport and return a function
 * that forwards a raw JSON-RPC message and resolves with the server's JSON-RPC
 * response (correlated by `id`). Notifications (no `id`) resolve to {}.
 */
export async function createMcpBridge(instance: McpServer): Promise<McpBridge> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await instance.connect(serverT);
  await clientT.start();

  const pending = new Map<string | number, (msg: Record<string, unknown>) => void>();
  clientT.onmessage = (msg: any) => {
    const id = msg?.id;
    if (id !== undefined && id !== null && pending.has(id)) {
      const resolve = pending.get(id)!;
      pending.delete(id);
      resolve(msg as Record<string, unknown>);
    }
    // server-initiated requests/notifications (no matching pending) are ignored
  };

  return (message: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const id = (message as any)?.id;
    if (id === undefined || id === null) {
      // notification — deliver it; CLI still expects an mcp_response envelope.
      void clientT.send(message as any);
      return Promise.resolve({ jsonrpc: '2.0', result: {}, id: 0 });
    }
    return new Promise<Record<string, unknown>>((resolve) => {
      pending.set(id, resolve);
      void clientT.send(message as any);
    });
  };
}
