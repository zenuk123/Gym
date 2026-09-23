import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SubHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { AI_MODELS, DEFAULT_AI, aiReady, proxyAvailable, saveAi, useAiSettings, type AiMode, type AiModel, type AiSettings } from './aiSettings';
import { createClient, describeError, modelParams } from './claude';
import './coach.css';

/** Connect the coach to Claude: your own API key (kept on this device) or your Supabase proxy. */
export function AiSettingsPage() {
  const stored = useAiSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (!stored) return <main className="page" />;
  const s = draft ?? stored;
  const set = (p: Partial<AiSettings>) => {
    setDraft({ ...s, ...p });
    setResult(null);
  };

  async function save() {
    await saveAi(s);
    setDraft(null);
    toast(s.mode === 'off' ? 'AI coach turned off' : 'AI settings saved');
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const client = await createClient(s);
      const msg = await client.beta.messages
        .stream({ ...modelParams(s.model), max_tokens: 1024, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with just the word OK.' }] })
        .finalMessage();
      setResult({ ok: msg.stop_reason !== 'refusal', text: `Connected to ${msg.model}.` });
    } catch (err) {
      setResult({ ok: false, text: await describeError(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <main className="page">
      <SubHeader title="AI coach" />
      <p className="muted" style={{ fontSize: 15 }}>
        The AI coach and meal ideas use Claude, by Anthropic. When you ask something, only the data the coach looks up for that answer is sent to Anthropic. It can read your data — it can never change your targets, programme or logs.
      </p>

      <div className="field">
        <span className="label">Connection</span>
        <Segmented<AiMode>
          label="Connection"
          value={s.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'key', label: 'My API key' },
            ...(proxyAvailable ? [{ value: 'proxy' as const, label: 'My server' }] : []),
          ]}
        />
      </div>

      {s.mode === 'key' && (
        <>
          <div className="field">
            <label htmlFor="ai-key">Anthropic API key</label>
            <div className="input-wrap">
              <input
                id="ai-key"
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                value={s.apiKey}
                onChange={(e) => set({ apiKey: e.target.value })}
              />
            </div>
            <span className="hint">
              Create one at console.anthropic.com → API keys, and set a monthly spend limit there. The key is stored only on this device (never synced or included in
              backups) and is sent straight to Anthropic.
            </span>
          </div>
        </>
      )}

      {s.mode === 'proxy' && (
        <p className="faint" style={{ fontSize: 14 }}>
          Requests go through the <code>claude</code> Edge Function in your Supabase project, which keeps the API key on the server and only answers signed-in users. See the
          README for the one-time setup. <Link to="/more/account">Account & sync</Link>
        </p>
      )}

      {s.mode !== 'off' && (
        <div className="field">
          <span className="label">Model</span>
          <div className="list">
            {AI_MODELS.map((m) => (
              <button key={m.id} className="list-row" aria-pressed={s.model === m.id} onClick={() => set({ model: m.id as AiModel })}>
                <div className="grow">
                  <div className="title">{m.label}</div>
                  <div className="desc">{m.hint}</div>
                </div>
                <span className={`radio${s.model === m.id ? ' on' : ''}`} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}

      {result && <p className={result.ok ? 'pill good' : 'chat-error'}>{result.text}</p>}

      <div className="btn-row">
        {s.mode !== 'off' && (
          <button className="btn" onClick={() => void test()} disabled={testing || !aiReady(s)}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        )}
        <button className="btn btn-primary" onClick={() => void save()} disabled={!draft || (s.mode !== 'off' && !aiReady(s))}>
          Save
        </button>
      </div>
      {stored.mode !== 'off' && (
        <button
          className="btn btn-ghost btn-block"
          onClick={async () => {
            await saveAi(DEFAULT_AI);
            setDraft(null);
            toast('Key removed from this device');
          }}
        >
          Remove key & turn off
        </button>
      )}
    </main>
  );
}
