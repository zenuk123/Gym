import { SubHeader } from '../../../components/PageHeader';
import { HealthCard } from './HealthCard';
import { RemindersCard } from './RemindersCard';
import { WearablesCard } from './WearablesCard';
import './devices.css';

/** Phase 7: Apple Health / Health Connect, wearables and reminders in one place. */
export function DevicesPage() {
  return (
    <main className="page">
      <SubHeader title="Health & devices" />
      <HealthCard />
      <WearablesCard />
      <RemindersCard />
    </main>
  );
}
