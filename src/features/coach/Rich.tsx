import { Fragment, type ReactNode } from 'react';

// Tiny, safe renderer for coach replies: paragraphs, "- " bullets, **bold**, and the
// [Fact] / [Calculation] / [Suggestion] / [General] tags as pills. No HTML is ever injected.

const TAGS: Record<string, { cls: string; label: string }> = {
  fact: { cls: 'kind-fact', label: 'Fact' },
  calculation: { cls: 'kind-calculation', label: 'Calculation' },
  suggestion: { cls: 'kind-suggestion', label: 'Suggestion' },
  general: { cls: 'kind-general', label: 'General' },
};
const TAG_RE = /^(?:\*\*)?\[(fact|calculation|suggestion|general)\](?:\*\*)?:?\s*/i;

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>,
  );
}

function Line({ text }: { text: string }) {
  const m = TAG_RE.exec(text);
  const tag = m ? TAGS[m[1].toLowerCase()] : null;
  const rest = m ? text.slice(m[0].length) : text;
  return (
    <>
      {tag && <span className={`pill ${tag.cls}`}>{tag.label}</span>} {inline(rest)}
    </>
  );
}

export function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    blocks.push(
      <ul key={blocks.length}>
        {items.map((b, i) => (
          <li key={i}>
            <Line text={b} />
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = /^(?:[-•*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(<p key={blocks.length}>{heading ? <b>{heading[1]}</b> : <Line text={line} />}</p>);
  }
  flush();
  return <div className="rich">{blocks}</div>;
}
