/**
 * Standalone stdio MCP server exposing dorabot tools.
 * Spawned by the claude CLI via --mcp-config when using the claude-cli provider.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screenshotTool } from './tools/screenshot.js';
import { browserTool } from './tools/browser.js';
import { calendarTools } from './tools/calendar.js';
import { goalsTools } from './tools/goals.js';
import { tasksTools } from './tools/tasks.js';
import { researchTools } from './tools/research.js';
import { memoryTools } from './tools/memory.js';
import { messageTool, registerChannelHandler } from './tools/messaging.js';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

const dorabotHome = process.env.DORABOT_HOME || `${process.env.HOME}/.dorabot`;

// Connect to the gateway and register a proxy channel handler so messageTool
// forwards sends/edits/deletes through the gateway's live Telegram connection.
async function connectGatewayProxy(): Promise<void> {
  const sockPath = join(dorabotHome, 'gateway.sock');
  const tokenPath = join(dorabotHome, 'gateway-token');
  let token: string;
  try {
    token = readFileSync(tokenPath, 'utf-8').trim();
  } catch {
    return; // no gateway token — message tool will fall back to console
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(`ws+unix://${sockPath}:`);
    let reqId = 0;
    const pending = new Map<string, (result: unknown, error?: string) => void>();

    const rpc = (method: string, params: Record<string, unknown>): Promise<unknown> => {
      return new Promise((res, rej) => {
        const id = String(++reqId);
        pending.set(id, (result, error) => error ? rej(new Error(error)) : res(result));
        ws.send(JSON.stringify({ method, params, id }));
      });
    };

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id) {
          const cb = pending.get(msg.id);
          if (cb) { pending.delete(msg.id); cb(msg.result, msg.error); }
        }
      } catch { /* ignore */ }
    });

    ws.on('open', async () => {
      try {
        await rpc('auth', { token });
        // Register proxy handler for all channels — routes through gateway
        const makeProxy = (channel: string) => ({
          async send(target: string, message: string, opts?: { media?: string; replyTo?: string }) {
            const r = await rpc('message.proxy', { action: 'send', channel, target, message, ...opts }) as { id: string; chatId: string };
            return r;
          },
          async edit(messageId: string, message: string, chatId?: string) {
            await rpc('message.proxy', { action: 'edit', channel, messageId, message, chatId: chatId || '' });
          },
          async delete(messageId: string, chatId?: string) {
            await rpc('message.proxy', { action: 'delete', channel, messageId, chatId: chatId || '' });
          },
        });
        for (const ch of ['telegram', 'whatsapp']) {
          registerChannelHandler(ch, makeProxy(ch));
        }
        resolve();
      } catch {
        resolve(); // fall back to console handler
      }
    });

    ws.on('error', () => resolve()); // fall back gracefully
    setTimeout(resolve, 3000); // don't block startup if gateway is slow
  });
}

await connectGatewayProxy();

const server = new McpServer({ name: 'dorabot-tools', version: '1.0.0' });

const tools: SdkMcpToolDefinition<any>[] = [
  messageTool,
  screenshotTool,
  browserTool,
  ...calendarTools,
  ...goalsTools,
  ...tasksTools,
  ...researchTools,
  ...memoryTools,
];

for (const t of tools) {
  server.tool(t.name, t.description, t.inputSchema, async (args: Record<string, unknown>) => {
    return await t.handler(args as any, {});
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
