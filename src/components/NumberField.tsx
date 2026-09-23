import { useId, type ReactNode } from 'react';

/**
 * Numeric input tuned for iPhone: shows the decimal (or number) keypad,
 * accepts "," as a decimal separator, and is big enough to hit mid-set.
 */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  decimal = true,
  big = false,
  hint,
  placeholder,
  autoFocus,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  decimal?: boolean;
  big?: boolean;
  hint?: ReactNode;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`input-wrap${big ? ' big' : ''}`}>
        <input
          id={id}
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          pattern={decimal ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
          autoComplete="off"
          enterKeyHint="done"
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ''))}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  autoFocus,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize={type === 'text' ? 'words' : 'none'}
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
