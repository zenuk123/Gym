/** Date-range filter: one row, above everything it scopes. */
export function RangeChips<T extends number | string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="chip-scroll range-chips" role="group" aria-label="Date range">
      {options.map((o) => (
        <button key={String(o.value)} className="chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
