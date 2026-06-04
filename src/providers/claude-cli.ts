// ── Direct Claude Code CLI driver ───────────────────────────────────
// Drives the system `claude` binary as a subprocess over the stream-json
// control protocol, replacing `query()` from @anthropic-ai/claude-agent-sdk.
//
// The returned object is shaped like the SDK's query() result: it is an
// AsyncIterable<message> and exposes interrupt()/setModel()/setPermissionMode()/
// stopTask()/mcpServerStatus()/reconnectMcpServer()/toggleMcpServer(), so the
// existing ClaudeProvider.query() needs only a minimal change to use it.
//
// Protocol facts (verified against claude v2.0.8):
//   • base argv: --print --output-format stream-json --verbose --input-format stream-json
//   • full-replacement system prompt → --system-prompt FLAG (initialize.systemPrompt is ignored by 2.0.8)
//   • user messages and control_requests are newline-delimited JSON on stdin
//   • canUseTool is enabled with `--permission-prompt-tool stdio`; the CLI then
//     sends `can_use_tool` control_requests which we answer with a PermissionResult
//   • in-process MCP servers are advertised in the initialize control_request
//     (sdkMcpServers: [names]); the CLI routes their JSON-RPC over `mcp_message`
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ── Message / control envelope types ────────────────────────────────
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export type CliUserMessage = {
  type: 'user';
  session_id: string;
  message: { role: 'user'; content: ContentBlock[] };
  parent_tool_use_id: null;
};

/** A parsed line off the CLI's stdout that is NOT a control frame. */
export type CliStreamMessage = { type: string; [key: string]: unknown };

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

/** Handles a JSON-RPC message destined for an in-process MCP server. */
export type McpMessageHandler = (
  serverName: string,
  message: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** A hook callback (matches jarvis's HookCallback shape). */
export type HookCallbackFn = (
  input: any,
  toolUseId: string | undefined,
  options: { signal?: AbortSignal },
) => Promise<any>;
export type HookMatcher = { matcher?: string; hooks: HookCallbackFn[]; timeout?: number };
/** event name → matchers (e.g. { PreToolUse: [{ matcher, hooks: [...] }] }). */
export type HooksConfig = Record<string, HookMatcher[]>;

export type CliQueryOptions = {
  /** Path to the `claude` executable (resolved by the caller). */
  claudePath: string;
  /** Async source of user messages; keeps stdin open for injection. */
  prompt: AsyncIterable<CliUserMessage>;

  systemPrompt?: string;
  appendSystemPrompt?: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  allowDangerouslySkipPermissions?: boolean;
  resume?: string;
  forkSession?: boolean;
  agents?: Record<string, unknown>;
  maxTurns?: number;
  effort?: 'low' | 'medium' | 'high' | 'max';
  maxThinkingTokens?: number;
  maxBudgetUsd?: number;
  cwd?: string;
  env?: Record<string, string | undefined>;
  abortController?: AbortController;

  /** External MCP servers (stdio/http) → serialized to --mcp-config. */
  mcpConfig?: Record<string, unknown>;
  strictMcpConfig?: boolean;
  /** In-process MCP server names advertised in initialize.sdkMcpServers. */
  sdkMcpServerNames?: string[];
  /** Bridge for mcp_message control_requests (Phase 2 wires this to the server instance). */
  onMcpMessage?: McpMessageHandler;

  /** Permission callback; presence adds `--permission-prompt-tool stdio`. */
  canUseTool?: (toolName: string, input: Record<string, unknown>, options: unknown) => Promise<PermissionResult>;
  /** Hooks advertised in initialize and invoked via hook_callback control_requests. */
  hooks?: HooksConfig;

  stderr?: (data: string) => void;
};

/** SDK-query-compatible return value. */
export interface CliQuery extends AsyncIterable<CliStreamMessage> {
  interrupt(): Promise<void>;
  setModel(model?: string): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  mcpServerStatus(): Promise<unknown[]>;
  reconnectMcpServer(name: string): Promise<void>;
  toggleMcpServer(name: string, enabled: boolean): Promise<void>;
}

// ── argv construction ───────────────────────────────────────────────
export function buildArgs(o: CliQueryOptions): string[] {
  const args = ['--print', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--include-partial-messages', '--replay-user-messages'];
  if (o.model) args.push('--model', o.model);
  if (o.systemPrompt !== undefined) args.push('--system-prompt', o.systemPrompt);
  if (o.appendSystemPrompt !== undefined) args.push('--append-system-prompt', o.appendSystemPrompt);
  if (o.allowedTools?.length) args.push('--allowedTools', o.allowedTools.join(','));
  if (o.disallowedTools?.length) args.push('--disallowedTools', o.disallowedTools.join(','));
  if (o.permissionMode) args.push('--permission-mode', o.permissionMode);
  if (o.allowDangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
  if (o.resume) args.push('--resume', o.resume);
  if (o.forkSession) args.push('--fork-session');
  if (o.agents && Object.keys(o.agents).length) args.push('--agents', JSON.stringify(o.agents));
  if (o.maxTurns !== undefined) args.push('--max-turns', String(o.maxTurns));
  if (o.effort) args.push('--effort', o.effort);
  if (o.maxThinkingTokens !== undefined) args.push('--max-thinking-tokens', String(o.maxThinkingTokens));
  if (o.maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(o.maxBudgetUsd));
  if (o.mcpConfig && Object.keys(o.mcpConfig).length) args.push('--mcp-config', JSON.stringify({ mcpServers: o.mcpConfig }));
  if (o.strictMcpConfig) args.push('--strict-mcp-config');
  // canUseTool over the control protocol
  if (o.canUseTool) args.push('--permission-prompt-tool', 'stdio');
  return args;
}

// ── driver ──────────────────────────────────────────────────────────
const INIT_TIMEOUT_MS = 120_000;

export function queryViaCli(opts: CliQueryOptions): CliQuery {
  const proc: ChildProcess = spawn(opts.claudePath, buildArgs(opts), {
    cwd: opts.cwd,
    env: { ...opts.env, CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' } as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: opts.abortController?.signal,
  });

  // EPIPE guard: subprocess may exit before we finish writing.
  proc.stdin!.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') console.error(`[claude-cli] stdin error: ${err.message}`);
  });

  // ── outbound writer ──
  const writeLine = (obj: unknown): void => {
    if (!proc.stdin!.writable) return;
    try { proc.stdin!.write(JSON.stringify(obj) + '\n'); } catch { /* ignore */ }
  };

  // pending control_request → resolver, keyed by request_id
  const pending = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  const sendControl = (subtype: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const request_id = randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(request_id, { resolve, reject });
      writeLine({ type: 'control_request', request_id, request: { subtype, ...extra } });
    });
  };

  // ── inbound message queue (consumer side of the async iterator) ──
  const msgQueue: CliStreamMessage[] = [];
  let msgWaiter: ((m: IteratorResult<CliStreamMessage>) => void) | null = null;
  let done = false;
  let exitError: Error | null = null;

  const pushMsg = (m: CliStreamMessage): void => {
    if (msgWaiter) { const w = msgWaiter; msgWaiter = null; w({ value: m, done: false }); }
    else msgQueue.push(m);
  };
  const endMsgs = (): void => {
    done = true;
    if (msgWaiter) { const w = msgWaiter; msgWaiter = null; w({ value: undefined as any, done: true }); }
  };

  // ── handle an inbound control_request (CLI → us) ──
  const handleInboundControl = async (frame: any): Promise<void> => {
    const reqId = frame.request_id;
    const req = frame.request || {};
    const ok = (response: Record<string, unknown>) =>
      writeLine({ type: 'control_response', response: { subtype: 'success', request_id: reqId, response } });
    const fail = (error: string) =>
      writeLine({ type: 'control_response', response: { subtype: 'error', request_id: reqId, error } });
    try {
      switch (req.subtype) {
        case 'can_use_tool': {
          if (!opts.canUseTool) return fail('canUseTool callback is not provided.');
          const result = await opts.canUseTool(req.tool_name, req.input ?? {}, {
            signal: opts.abortController?.signal,
            suggestions: req.permission_suggestions,
            tool_use_id: req.tool_use_id,
          });
          return ok(result as Record<string, unknown>);
        }
        case 'mcp_message': {
          if (!opts.onMcpMessage) return fail('no MCP bridge registered');
          // The CLI expects the JSON-RPC reply wrapped in `mcp_response`.
          const jsonrpc = await opts.onMcpMessage(req.server_name, req.message);
          return ok({ mcp_response: jsonrpc });
        }
        case 'hook_callback': {
          const cb = hookCallbacks.get(req.callback_id);
          if (!cb) return fail(`No hook callback found for ID: ${req.callback_id}`);
          const out = await cb(req.input, req.tool_use_id, { signal: opts.abortController?.signal });
          return ok(out ?? { continue: true });
        }
        default:
          return fail(`unsupported control_request subtype: ${req.subtype}`);
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  // ── stdout line parser ──
  let buf = '';
  proc.stdout!.on('data', (d: Buffer) => {
    buf += d.toString();
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let frame: any;
      try { frame = JSON.parse(line); } catch { continue; }
      if (frame.type === 'control_response') {
        const r = frame.response || {};
        const p = pending.get(r.request_id);
        if (p) {
          pending.delete(r.request_id);
          if (r.subtype === 'error') p.reject(new Error(r.error || 'control_request failed'));
          else p.resolve(r.response ?? {});
        }
      } else if (frame.type === 'control_request') {
        void handleInboundControl(frame);
      } else {
        pushMsg(frame as CliStreamMessage);
      }
    }
  });

  if (opts.stderr) proc.stderr!.on('data', (d: Buffer) => opts.stderr!(d.toString()));

  proc.on('error', (err) => { exitError = err; pending.forEach(p => p.reject(err)); pending.clear(); endMsgs(); });
  proc.on('exit', () => { pending.forEach(p => p.reject(new Error('claude exited'))); pending.clear(); endMsgs(); });

  // ── hook registry: assign opaque callback_ids, build initialize payload ──
  const hookCallbacks = new Map<string, HookCallbackFn>();
  const serializedHooks: Record<string, Array<{ matcher?: string; hookCallbackIds: string[]; timeout?: number }>> = {};
  let nextHookId = 0;
  if (opts.hooks) {
    for (const [event, matchers] of Object.entries(opts.hooks)) {
      serializedHooks[event] = (matchers ?? []).map((m) => {
        const hookCallbackIds: string[] = [];
        for (const fn of m.hooks ?? []) {
          const id = `hook_${nextHookId++}`;
          hookCallbacks.set(id, fn);
          hookCallbackIds.push(id);
        }
        return { matcher: m.matcher, hookCallbackIds, timeout: m.timeout };
      });
    }
  }

  // ── startup: initialize handshake, then pump user messages ──
  const started = (async () => {
    const initResp = sendControl('initialize', {
      hooks: serializedHooks,
      sdkMcpServers: opts.sdkMcpServerNames ?? [],
      ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
      ...(opts.appendSystemPrompt !== undefined ? { appendSystemPrompt: opts.appendSystemPrompt } : {}),
      ...(opts.agents ? { agents: opts.agents } : {}),
    });
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('initialize timeout')), INIT_TIMEOUT_MS).unref?.());
    await Promise.race([initResp, timeout]);

    // pump user messages from the async generator into stdin
    for await (const userMsg of opts.prompt) {
      if (done || opts.abortController?.signal.aborted) break;
      writeLine(userMsg);
    }
  })().catch((err) => { exitError = err; endMsgs(); });

  // ── the AsyncIterable + control methods ──
  const iterator: AsyncIterator<CliStreamMessage> = {
    async next(): Promise<IteratorResult<CliStreamMessage>> {
      if (msgQueue.length) return { value: msgQueue.shift()!, done: false };
      if (done) {
        if (exitError) throw exitError;
        return { value: undefined as any, done: true };
      }
      return new Promise<IteratorResult<CliStreamMessage>>((resolve) => { msgWaiter = resolve; });
    },
    async return(): Promise<IteratorResult<CliStreamMessage>> {
      endMsgs();
      try { proc.kill(); } catch { /* ignore */ }
      return { value: undefined as any, done: true };
    },
  };

  const query: CliQuery = {
    [Symbol.asyncIterator]() { return iterator; },
    async interrupt() { await sendControl('interrupt'); },
    async setModel(model?: string) { await sendControl('set_model', { model }); },
    async setPermissionMode(mode: string) { await sendControl('set_permission_mode', { mode }); },
    async stopTask(taskId: string) { await sendControl('stop_task', { task_id: taskId }); },
    async mcpServerStatus() { const r = await sendControl('mcp_status'); return (r as any) ?? []; },
    async reconnectMcpServer(name: string) { await sendControl('mcp_reconnect', { serverName: name }); },
    async toggleMcpServer(name: string, enabled: boolean) { await sendControl('mcp_toggle', { serverName: name, enabled }); },
  };
  // keep a reference so `started` isn't GC'd before it runs
  void started;
  return query;
}
