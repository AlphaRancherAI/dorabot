/**
 * Standalone stdio MCP server exposing dorabot tools.
 * Spawned by the claude CLI via --mcp-config when using the claude-cli provider.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { screenshotTool } from './tools/screenshot.js';
import { browserTool } from './tools/browser.js';
import { calendarTools } from './tools/calendar.js';
import { goalsTools } from './tools/goals.js';
import { tasksTools } from './tools/tasks.js';
import { researchTools } from './tools/research.js';
import { memoryTools } from './tools/memory.js';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

const server = new McpServer({ name: 'dorabot-tools', version: '1.0.0' });

const tools: SdkMcpToolDefinition<any>[] = [
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
