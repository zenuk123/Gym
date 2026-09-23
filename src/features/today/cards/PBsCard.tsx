import { CardHead, EmptyState } from '../../../components/CardHead';

/** Filled automatically by PB detection in Phase 2 (weight, rep, volume and e1RM PBs). */
export function PBsCard() {
  return (
    <section className="card">
      <CardHead icon="trophy" tone="var(--pb)" title="Recent PBs" />
      <EmptyState icon="trophy">Personal bests are detected automatically once you start logging workouts.</EmptyState>
    </section>
  );
}
