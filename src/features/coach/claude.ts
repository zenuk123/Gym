import type Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlock, BetaMessage, BetaMessageParam, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { accessToken } from '../../sync/manager';
import { PROXY_URL, type AiSettings } from './aiSettings';

// Thin wrapper over the Anthropic TypeScript SDK (loaded on demand so it never weighs on
// app start-up). Two ways to reach the API:
//  - "key":   the user's own API key, stored only on this device, sent straight to Anthropic.
//  - "proxy": our Supabase Edge Function, which holds the key server-side and checks the
//             signed-in user (supabase/functions/claude).

export type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];

export class CoachError extends Error {}

export async function createClient(s: AiSettings): Promise<Anthropic> {
  const { default: SDK } = await import('@anthropic-ai/sdk');
  if (s.mode === 'key') return new SDK({ apiKey: s.apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 2 });
  if (s.mode === 'proxy') {
    const token = await accessToken();
    if (!token) throw new CoachError('Sign in (More → Account & sync) to use the coach through your server.');
    return new SDK({ apiKey: null, authToken: token, baseURL: PROXY_URL, dangerouslyAllowBrowser: true, maxRetries: 2 });
  }
  throw new CoachError('The AI coach is switched off. Turn it on in More → AI coach.');
}

/** Model-specific request options: Opus 5 opts into server-side refusal fallbacks. */
export function modelParams(model: AiSettings['model']): Pick<StreamParams, 'model' | 'betas' | 'fallbacks'> {
  return model === 'claude-opus-5' ? { model, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : { model };
}

/** Friendly message for anything the SDK throws. */
export async function describeError(err: unknown): Promise<string> {
  if (err instanceof CoachError) return err.message;
  const { default: SDK } = await import('@anthropic-ai/sdk');
  if (err instanceof SDK.APIUserAbortError) return 'Stopped.';
  if (err instanceof SDK.AuthenticationError) return 'The API key was rejected. Check it in More → AI coach.';
  if (err instanceof SDK.PermissionDeniedError) return 'This key or account isn’t allowed to use that model.';
  if (err instanceof SDK.RateLimitError) return 'Rate limit reached — wait a minute and try again.';
  if (err instanceof SDK.APIConnectionError) return navigator.onLine ? 'Couldn’t reach the AI service. Try again.' : 'You’re offline. The coach needs a connection — everything else keeps working.';
  if (err instanceof SDK.InternalServerError) return 'The AI service is busy right now. Try again shortly.';
  if (err instanceof SDK.BadRequestError) return `The request was rejected: ${err.message}`;
  if (err instanceof SDK.APIError) return `AI error ${err.status ?? ''}: ${err.message}`;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/**
 * Content to send back as the assistant turn. After a mid-output fallback to another model,
 * thinking and tool_use blocks that come before the last `fallback` marker must be omitted.
 */
export function echoable(content: BetaContentBlock[]): BetaMessageParam['content'] {
  const cut = content.map((b) => b.type).lastIndexOf('fallback');
  const kept = cut < 0 ? content : content.filter((b, i) => i > cut || !(b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'tool_use'));
  return kept as BetaMessageParam['content'];
}

export interface LoopTool {
  definitions: StreamParams['tools'];
  validate: (name: string, input: unknown) => string | null;
  run: (name: string, input: Record<string, unknown>) => Promise<unknown>;
}

export interface LoopEvents {
  onText: (delta: string) => void;
  /** A turn is being re-issued: drop the text streamed during it. */
  onTurnReset: () => void;
  onTool: (name: string) => void;
}

export type LoopEnd = 'done' | 'refusal' | 'truncated';

/**
 * Manual streaming tool loop. Mutates `messages` (appends assistant turns and tool results)
 * and returns why it stopped.
 */
export async function runLoop(
  client: Anthropic,
  base: Omit<StreamParams, 'messages'>,
  messages: BetaMessageParam[],
  tools: LoopTool,
  ev: LoopEvents,
  signal: AbortSignal,
): Promise<LoopEnd> {
  const { default: SDK } = await import('@anthropic-ai/sdk');
  let jsonRetries = 0;
  for (let round = 0; round < 12; round++) {
    const stream = client.beta.messages.stream({ ...base, tools: tools.definitions, messages } as StreamParams, { signal });
    stream.on('text', (delta) => ev.onText(delta));
    let message: BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Only an unparseable streamed tool input is retried; API errors and aborts propagate.
      if (err instanceof SDK.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
      ev.onTurnReset();
      round--;
      continue;
    }

    // A refusal can cut a tool_use off mid-input: never run that turn's tools.
    if (message.stop_reason === 'refusal') return 'refusal';
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: echoable(message.content) });
      continue;
    }
    const content = echoable(message.content) as BetaContentBlock[];
    const uses = content.filter((b): b is Extract<BetaContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (uses.length === 0) {
      messages.push({ role: 'assistant', content });
      return message.stop_reason === 'max_tokens' ? 'truncated' : 'done';
    }
    // A tool input cut off at max_tokens can still parse — don't run it.
    if (message.stop_reason === 'max_tokens') return 'truncated';

    messages.push({ role: 'assistant', content });
    const results: BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const problem = tools.validate(u.name, u.input);
      if (problem) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(u.input), error: problem }) });
        continue;
      }
      ev.onTool(u.name);
      try {
        const out = await tools.run(u.name, u.input as Record<string, unknown>);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: e instanceof Error ? e.message : 'Tool failed' });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return 'truncated';
}
