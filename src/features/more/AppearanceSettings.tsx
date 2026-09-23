import { useState } from 'react';
import { SubHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { updateProfile } from '../../db/repo';
import type { LengthUnit, Profile, WeightUnit } from '../../db/types';
import { getThemePref, setThemePref, type ThemePref } from '../../lib/theme';

export function AppearanceSettings({ profile }: { profile: Profile }) {
  const [theme, setTheme] = useState<ThemePref>(getThemePref);

  return (
    <main className="page">
      <SubHeader title="Appearance & units" />
      <div className="field">
        <span className="label">Theme</span>
        <Segmented
          label="Theme"
          value={theme}
          onChange={(t) => {
            setTheme(t);
            setThemePref(t);
          }}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
        />
      </div>
      <div className="field">
        <span className="label">Weight</span>
        <Segmented<WeightUnit>
          label="Weight unit"
          value={profile.weightUnit}
          onChange={(u) => void updateProfile({ weightUnit: u })}
          options={[
            { value: 'kg', label: 'Kilograms (kg)' },
            { value: 'lb', label: 'Pounds (lb)' },
          ]}
        />
      </div>
      <div className="field">
        <span className="label">Body measurements</span>
        <Segmented<LengthUnit>
          label="Length unit"
          value={profile.lengthUnit}
          onChange={(u) => void updateProfile({ lengthUnit: u })}
          options={[
            { value: 'cm', label: 'Centimetres' },
            { value: 'in', label: 'Inches' },
          ]}
        />
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        Data is always stored in metric, so switching units never loses precision.
      </p>
    </main>
  );
}
