import { CardHead } from '../../../components/CardHead';
import type { Insight } from '../../../lib/insights';

const KIND_LABEL = { fact: 'Fact', calculation: 'Calculation', suggestion: 'Suggestion' } as const;

export function CoachCard({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <section className="card coach-card">
      <CardHead icon="brain" tone="var(--coach)" title="Coach insight" />
      {insights.slice(0, 2).map((i) => (
        <div key={i.id} className="insight">
          <span className={`pill kind-${i.kind}`}>{KIND_LABEL[i.kind]}</span>
          <p>{i.text}</p>
        </div>
      ))}
    </section>
  );
}
