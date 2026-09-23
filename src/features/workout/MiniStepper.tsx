import { Icon } from '../../components/Icon';
import { haptic } from '../../pwa/platform';

/** Compact − value + control for small integers (sets, reps, warm-ups). */
export function MiniStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const set = (v: number) => {
    haptic(5);
    onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <div className="mini-stepper" role="group" aria-label={label}>
      <span className="mini-label">{label}</span>
      <div className="mini-row">
        <button type="button" onClick={() => set(value - 1)} disabled={value <= min} aria-label={`Decrease ${label}`}>
          <Icon name="minus" />
        </button>
        <span className="num" aria-live="polite">
          {value}
        </span>
        <button type="button" onClick={() => set(value + 1)} disabled={value >= max} aria-label={`Increase ${label}`}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}
