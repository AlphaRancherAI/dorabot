import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult } from './types.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

type OllamaMessage = {
  role: string;
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
};

type OllamaChunk = {
  model: string;
  message?: {
    role: string;
    content: string;
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
};

type OllamaTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export class OllamaProvider implements Provider {
  readonly name = 'ollama';

  private baseUrl(config: ProviderRunOptions['config']): string {
    return config.provider?.ollama?.baseUrl ?? DEFAULT_BASE_URL;
  }

  async checkReady(config?: ProviderRunOptions['config']): Promise<{ ready: boolean; reason?: string }> {
    const url = config ? this.baseUrl(config) : DEFAULT_BASE_URL;
    try {
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return { ready: true };
      return { ready: false, reason: `Ollama returned HTTP ${res.status}` };
    } catch {
      return { ready: false, reason: `Cannot reach Ollama at ${url}. Is it running? (ollama serve)` };
    }
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    const { ready, reason } = await this.checkReady();
    return { authenticated: ready, error: ready ? undefined : reason, tokenHealth: 'valid' };
  }

  async loginWithApiKey(_apiKey: string): Promise<ProviderAuthStatus> {
    return this.getAuthStatus();
  }

  async *query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown> {
    const baseUrl = this.baseUrl(opts.config);
    const model = opts.model || 'llama3.2';
    const sessionId = opts.resumeId || `ollama-${Date.now()}`;
    const signal = opts.abortController?.signal;

    yield { type: 'system', subtype: 'init', session_id: sessionId, model } as ProviderMessage;

    // ── Connect to in-process MCP server for tool support ─────────────
    type McpClient = import('@modelcontextprotocol/sdk/client/index.js').Client;
    let mcpClient: McpClient | null = null;
    let ollamaTools: OllamaTool[] = [];

    const internalServer = (opts.mcpServer as Record<string, unknown> | undefined)?.['dorabot-tools'] as
      | { connect(t: unknown): Promise<void> }
      | undefined;

    if (internalServer?.connect) {
      try {
        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
        const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await internalServer.connect(serverTransport);
        mcpClient = new Client({ name: 'ollama-provider', version: '1.0.0' }, {});
        await mcpClient.connect(clientTransport);
        const { tools } = await mcpClient.listTools();
        ollamaTools = tools.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description ?? '',
            parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
          },
        }));
        console.log(`[ollama] MCP connected — ${ollamaTools.length} tools available`);
      } catch (err) {
        console.warn('[ollama] MCP connection failed, running without tools:', err);
        mcpClient = null;
        ollamaTools = [];
      }
    }

    // ── Build initial message history ─────────────────────────────────
    const messages: OllamaMessage[] = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    messages.push({ role: 'user', content: opts.prompt });

    let result = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const maxLoops = opts.maxTurns ?? 20;

    try {
      for (let loop = 0; loop < maxLoops; loop++) {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            tools: ollamaTools.length > 0 ? ollamaTools : undefined,
            stream: true,
          }),
          signal,
        });

        if (!res.ok) {
          throw new Error(`Ollama API error ${res.status}: ${await res.text().catch(() => '')}`);
        }
        if (!res.body) throw new Error('No response body from Ollama');

        // ── Stream the response ──────────────────────────────────────
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let blockOpen = false;
        let turnText = '';
        let turnToolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            let chunk: OllamaChunk;
            try { chunk = JSON.parse(line); } catch { continue; }

            const text = chunk.message?.content ?? '';
            if (text) {
              if (!blockOpen) {
                yield { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } } as ProviderMessage;
                blockOpen = true;
              }
              yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } } as ProviderMessage;
              turnText += text;
            }

            if (chunk.done) {
              inputTokens += chunk.prompt_eval_count ?? 0;
              outputTokens += chunk.eval_count ?? 0;
              if (chunk.message?.tool_calls?.length) {
                turnToolCalls = chunk.message.tool_calls.map(tc => ({
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                }));
              }
              break outer;
            }
          }
        }

        if (blockOpen) {
          yield { type: 'stream_event', event: { type: 'content_block_stop' } } as ProviderMessage;
        }

        // Emit assistant message — includes tool_use blocks so agent.ts can
        // track usedMessageTool and fire onToolUse callbacks
        const assistantContent: Array<Record<string, unknown>> = [];
        if (turnText) {
          assistantContent.push({ type: 'text', text: turnText });
          result = turnText;
        }
        for (const tc of turnToolCalls) {
          assistantContent.push({ type: 'tool_use', id: `tool-${Date.now()}`, name: tc.name, input: tc.arguments });
        }
        yield { type: 'assistant', message: { role: 'assistant', content: assistantContent } } as ProviderMessage;

        // ── No tool calls → we're done ───────────────────────────────
        if (turnToolCalls.length === 0) break;

        // ── Execute tool calls ───────────────────────────────────────
        messages.push({
          role: 'assistant',
          content: turnText,
          tool_calls: turnToolCalls.map(tc => ({ function: tc })),
        });

        for (const tc of turnToolCalls) {
          // Permission check
          if (opts.canUseTool) {
            const decision = await opts.canUseTool(tc.name, tc.arguments, {});
            if ((decision as { behavior?: string })?.behavior === 'deny') {
              messages.push({ role: 'tool', content: 'Tool use was denied.' });
              continue;
            }
          }

          // Execute via MCP client
          let toolResult: string;
          if (mcpClient) {
            try {
              const r = await mcpClient.callTool({ name: tc.name, arguments: tc.arguments });
              toolResult = (r.content as Array<{ type: string; text?: string }>)
                .filter(c => c.type === 'text')
                .map(c => c.text ?? '')
                .join('\n');
            } catch (err) {
              toolResult = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else {
            toolResult = 'Tool execution unavailable.';
          }

          messages.push({ role: 'tool', content: toolResult });
        }
      }

      yield {
        type: 'result',
        result,
        session_id: sessionId,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        total_cost_usd: 0,
      } as ProviderMessage;

    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // Partial result on cancellation
        yield {
          type: 'result',
          result,
          session_id: sessionId,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          total_cost_usd: 0,
        } as ProviderMessage;
      } else {
        yield {
          type: 'result',
          subtype: 'error_max_turns',
          result: `Ollama error: ${err instanceof Error ? err.message : String(err)}`,
          session_id: sessionId,
        } as ProviderMessage;
      }
    } finally {
      await (mcpClient as any)?.close?.();
    }

    return { result, sessionId, usage: { inputTokens, outputTokens, totalCostUsd: 0 } };
  }
}
