import { useState } from 'react';
import type { LengthUnit } from '../db/types';
import { parseDecimal, round } from '../lib/units';
import { NumberField } from './NumberField';

/** Height in cm, or feet + inches. Always reports centimetres (or null while invalid). */
export function HeightField({ cm, unit, onChange }: { cm: number | null; unit: LengthUnit; onChange: (cm: number | null) => void }) {
  const totalIn = cm !== null ? cm / 2.54 : null;
  const [cmStr, setCmStr] = useState(cm !== null ? String(round(cm, 0)) : '');
  const [ftStr, setFtStr] = useState(totalIn !== null ? String(Math.floor(round(totalIn, 0) / 12)) : '');
  const [inStr, setInStr] = useState(totalIn !== null ? String(round(totalIn, 0) % 12) : '');

  if (unit === 'cm') {
    return (
      <NumberField
        label="Height"
        suffix="cm"
        decimal={false}
        value={cmStr}
        placeholder="178"
        onChange={(v) => {
          setCmStr(v);
          const n = parseDecimal(v);
          onChange(n !== null && n >= 100 && n <= 250 ? n : null);
        }}
      />
    );
  }

  const update = (ft: string, inch: string) => {
    const f = parseDecimal(ft);
    const i = parseDecimal(inch || '0');
    const total = f !== null && i !== null ? f * 12 + i : null;
    onChange(total !== null && total >= 40 && total <= 100 ? total * 2.54 : null);
  };
  return (
    <div className="field-row">
      <NumberField
        label="Height (feet)"
        suffix="ft"
        decimal={false}
        value={ftStr}
        placeholder="5"
        onChange={(v) => {
          setFtStr(v);
          update(v, inStr);
        }}
      />
      <NumberField
        label="Inches"
        suffix="in"
        decimal={false}
        value={inStr}
        placeholder="10"
        onChange={(v) => {
          setInStr(v);
          update(ftStr, v);
        }}
      />
    </div>
  );
}
