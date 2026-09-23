import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { SubHeader } from '../../components/PageHeader';
import { getMeta, setMeta } from '../../db/db';
import type { Profile } from '../../db/types';
import { newId } from '../../lib/id';
import { useToday } from '../../lib/useToday';
import { aiReady, loadAi, useAiSettings } from './aiSettings';
import { createClient, describeError, modelParams, runLoop } from './claude';
import { COACH_SYSTEM, STARTERS, contextBlock, presetPrompt } from './prompt';
import { Rich } from './Rich';
import { toolDefinitions, toolStatus, validateInput, runTool } from './tools';
import './coach.css';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools: string[];
  error?: string;
}
interface Chat {
  api: BetaMessageParam[];
  display: ChatMsg[];
}

const CHAT_KEY = 'coach-chat';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Chat with the AI coach. It reads (never writes) your data through tools and labels every claim. */
export function CoachPage({ profile }: { profile: Profile }) {
  const today = useToday();
  const settings = useAiSettings();
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const [chat, setChat] = useState<Chat | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getMeta<Chat>(CHAT_KEY).then((c) => setChat(c ?? { api: [], display: [] }));
  }, []);

  // Prompts handed over from other screens (weekly review, meal plan …) go in the box, ready to send.
  useEffect(() => {
    const preset = presetPrompt(params.get('prompt'), params);
    if (preset) {
      setInput(preset);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [chat?.display.length, busy]);

  if (!chat || !settings) return <main className="page" />;
  const ready = aiReady(settings);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || !chat) return;
    const s = await loadAi();
    const api: BetaMessageParam[] = [...chat.api, { role: 'user', content: q }];
    const before = chat.api.length;
    const reply: ChatMsg = { id: newId(), role: 'assistant', text: '', tools: [] };
    let display = [...chat.display, { id: newId(), role: 'user' as const, text: q, tools: [] }, reply];
    const paint = () => setChat({ api, display: [...display] });
    const patch = (p: Partial<ChatMsg>) => {
      Object.assign(reply, p);
      display = display.map((m) => (m.id === reply.id ? { ...reply } : m));
      paint();
    };
    setInput('');
    setBusy('Thinking');
    paint();
    const ctrl = new AbortController();
    abort.current = ctrl;
    let turnStart = 0;
    try {
      const client = await createClient(s);
      const end = await runLoop(
        client,
        {
          ...modelParams(s.model),
          max_tokens: 64000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          system: [
            { type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: contextBlock(profile, today) },
          ],
        },
        api,
        { definitions: toolDefinitions(true), validate: validateInput, run: runTool },
        {
          onText: (d) => {
            setBusy(null);
            patch({ text: reply.text + d });
          },
          onTurnReset: () => patch({ text: reply.text.slice(0, turnStart) }),
          onTool: (name) => {
            turnStart = reply.text.length;
            if (reply.text && !reply.text.endsWith('\n')) patch({ text: reply.text + '\n\n' });
            setBusy(toolStatus(name));
            patch({ tools: [...new Set([...reply.tools, toolStatus(name)])] });
          },
        },
        ctrl.signal,
      );
      if (end === 'refusal') {
        api.splice(before); // don't carry a declined exchange into the next request
        patch({ error: 'The coach can’t help with that one. Try asking another way.' });
      } else if (end === 'truncated') {
        patch({ error: 'The answer was cut short. Ask it to continue or narrow the question.' });
      }
    } catch (err) {
      api.splice(before);
      patch({ error: await describeError(err) });
    } finally {
      setBusy(null);
      abort.current = null;
      const saved = { api, display };
      setChat(saved);
      await setMeta(CHAT_KEY, saved);
    }
  }

  async function reset() {
    abort.current?.abort();
    const empty = { api: [], display: [] };
    setChat(empty);
    await setMeta(CHAT_KEY, empty);
  }

  return (
    <main className="page coach-page">
      <SubHeader title="AI coach" back="/more" />

      {!ready ? (
        <section className="card">
          <div className="card-head" style={{ '--tone': 'var(--coach)' } as React.CSSProperties}>
            <span className="chip-icon">
              <Icon name="brain" />
            </span>
            <h2>Set up the coach</h2>
          </div>
          <p className="muted" style={{ fontSize: 15 }}>
            The coach uses Claude to answer questions about your own training, food, weight and sleep. It can read your data but never changes your targets or programme.
          </p>
          <Link to="/more/ai" className="btn btn-primary btn-block">
            Connect Claude
          </Link>
        </section>
      ) : (
        <>
          {!online && (
            <div className="banner">
              <Icon name="wifiOff" />
              <div className="grow">You’re offline. The coach needs a connection — logging and everything else still work.</div>
            </div>
          )}
          {chat.display.length === 0 ? (
            <section className="card">
              <p className="muted" style={{ fontSize: 15 }}>
                Ask anything about your progress. Answers are labelled <span className="pill kind-fact">Fact</span> <span className="pill kind-calculation">Calculation</span>{' '}
                <span className="pill kind-suggestion">Suggestion</span> or <span className="pill kind-general">General</span>, and suggestions never change anything by themselves.
              </p>
              <div className="starter-list">
                {STARTERS.map((s) => (
                  <button key={s} className="chip" onClick={() => void send(s)} disabled={!online}>
                    {s}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="chat" aria-live="polite">
              {chat.display.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="bubble user">
                    {m.text}
                  </div>
                ) : (
                  <div key={m.id} className="bubble bot">
                    {m.tools.length > 0 && <div className="tools-used">Checked: {m.tools.map((t) => t.toLowerCase()).join(' · ')}</div>}
                    {m.text && <Rich text={m.text} />}
                    {m.error && <p className="chat-error">{m.error}</p>}
                  </div>
                ),
              )}
              {busy && (
                <div className="typing" role="status">
                  <span className="dot" />
                  {busy}…
                </div>
              )}
              <button className="new-chat" onClick={() => void reset()} disabled={!!busy}>
                <Icon name="refresh" width={16} height={16} /> New conversation
              </button>
            </div>
          )}
          <div ref={endRef} />
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your coach…"
              aria-label="Message"
              rows={Math.min(5, Math.max(1, input.split('\n').length))}
              enterKeyHint="send"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            {busy ? (
              <button type="button" className="icon-btn send" onClick={() => abort.current?.abort()} aria-label="Stop">
                <Icon name="x" />
              </button>
            ) : (
              <button className="icon-btn send" disabled={!input.trim() || !online} aria-label="Send">
                <Icon name="send" />
              </button>
            )}
          </form>
          <p className="faint" style={{ fontSize: 12, textAlign: 'center' }}>
            AI can be wrong — check anything important. Not medical advice.
          </p>
        </>
      )}
    </main>
  );
}
