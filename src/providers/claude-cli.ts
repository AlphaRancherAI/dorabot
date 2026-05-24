import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult } from './types.js';

function findClaudeBinary(): string | null {
  const candidates = [
    `${process.env.HOME}/.claude/local/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const p = execSync(`${shell} -lc 'command -v claude'`, { timeout: 5000, encoding: 'utf-8' }).trim();
    if (p && existsSync(p)) return p;
  } catch { /* not found */ }
  return null;
}

export class ClaudeCliProvider implements Provider {
  readonly name = 'claude-cli';

  async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    const bin = findClaudeBinary();
    if (!bin) return { ready: false, reason: 'claude CLI not found — install Claude Code' };
    return { ready: true };
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    const bin = findClaudeBinary();
    if (!bin) return { authenticated: false, error: 'claude CLI not found' };
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      // claude --version to confirm CLI is working
      execSync(`${shell} -lc '${bin} --version'`, { timeout: 5000 });
      return { authenticated: true, method: 'oauth' };
    } catch {
      return { authenticated: false, error: 'claude CLI check failed' };
    }
  }

  resetAuth(): void { /* auth is managed by the claude CLI itself */ }

  async loginWithApiKey(_apiKey: string): Promise<ProviderAuthStatus> {
    return { authenticated: false, error: 'Use the claude CLI to authenticate: claude auth' };
  }

  async *query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown> {
    const claudeBin = findClaudeBinary();
    if (!claudeBin) throw new Error('claude CLI not found');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const mcpServerPath = join(__dirname, '../../dist/mcp-server.js');
    const dorabotHome = process.env.DORABOT_HOME || `${process.env.HOME}/.dorabot`;

    const mcpConfig = JSON.stringify({
      mcpServers: {
        dorabot: {
          type: 'stdio',
          command: process.execPath,
          args: [mcpServerPath],
          env: { DORABOT_HOME: dorabotHome },
        },
      },
    });

    const args = [
      '-p', opts.prompt,
      '--output-format', 'stream-json',
      '--mcp-config', mcpConfig,
      '--strict-mcp-config',
    ];
    if (opts.model) args.push('--model', opts.model);
    if (opts.resumeId) args.push('--resume', opts.resumeId);

    const proc = spawn(claudeBin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });

    proc.stderr.on('data', (d: Buffer) => {
      process.stderr.write(`[claude-cli] ${d}`);
    });

    const rl = createInterface({ input: proc.stdout });

    let sessionId = '';
    let result = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let totalCostUsd = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;
      let event: Record<string, unknown>;
      try { event = JSON.parse(line); } catch { continue; }

      if (event.type === 'system' && (event.subtype === 'init')) {
        sessionId = event.session_id as string || '';
        yield event as ProviderMessage;
      } else if (event.type === 'assistant') {
        yield event as ProviderMessage;
      } else if (event.type === 'result') {
        result = event.result as string || '';
        sessionId = event.session_id as string || sessionId;
        totalCostUsd = event.total_cost_usd as number || 0;
        const usage = event.usage as Record<string, number> | undefined;
        if (usage) {
          inputTokens = usage.input_tokens || 0;
          outputTokens = usage.output_tokens || 0;
        }
        yield event as ProviderMessage;
      }
    }

    await new Promise<void>(resolve => proc.on('close', resolve));

    return {
      result,
      sessionId,
      usage: { inputTokens, outputTokens, totalCostUsd },
    };
  }
}
