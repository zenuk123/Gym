import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeightField } from '../../components/HeightField';
import { NumberField, TextField } from '../../components/NumberField';
import { SubHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { updateProfile } from '../../db/repo';
import type { ActivityLevel, Goal, Profile, Sex } from '../../db/types';
import { ACTIVITY_LEVELS, GOALS } from '../../lib/calc/nutrition';
import { fromDisplayWeight, parseDecimal, round, toDisplayWeight } from '../../lib/units';

const thisYear = new Date().getFullYear();

export function ProfileSettings({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const toast = useToast();
  const u = profile.weightUnit;
  const [name, setName] = useState(profile.name);
  const [sex, setSex] = useState<Sex>(profile.sex);
  const [birthYear, setBirthYear] = useState(String(profile.birthYear));
  const [heightCm, setHeightCm] = useState<number | null>(profile.heightCm);
  const [goal, setGoal] = useState<Goal>(profile.goal);
  const [activity, setActivity] = useState<ActivityLevel>(profile.activityLevel);
  const [start, setStart] = useState(String(round(toDisplayWeight(profile.startWeightKg, u), 1)));
  const [target, setTarget] = useState(profile.targetWeightKg !== null ? String(round(toDisplayWeight(profile.targetWeightKg, u), 1)) : '');

  const by = parseDecimal(birthYear);
  const s = parseDecimal(start);
  const t = target.trim() === '' ? null : parseDecimal(target);
  const valid =
    name.trim() !== '' &&
    by !== null &&
    by >= thisYear - 100 &&
    by <= thisYear - 13 &&
    heightCm !== null &&
    s !== null &&
    s > 0 &&
    (target.trim() === '' || (t !== null && t > 0));

  async function save() {
    if (!valid) return;
    await updateProfile({
      name: name.trim(),
      sex,
      birthYear: by!,
      heightCm: round(heightCm!, 1),
      goal,
      activityLevel: activity,
      startWeightKg: round(fromDisplayWeight(s!, u), 2),
      targetWeightKg: t !== null ? round(fromDisplayWeight(t, u), 2) : null,
    });
    toast('Profile saved');
    if (goal !== profile.goal || activity !== profile.activityLevel) {
      toast('Goal changed — review your calorie target', { label: 'Review', run: () => navigate('/more/targets') });
    }
    navigate('/more');
  }

  return (
    <main className="page">
      <SubHeader title="Profile" />
      <TextField label="First name" value={name} onChange={setName} />
      <div className="field">
        <span className="label">Sex</span>
        <Segmented
          label="Sex"
          value={sex}
          onChange={setSex}
          options={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
            { value: 'other', label: 'Other' },
          ]}
        />
      </div>
      <NumberField label="Year of birth" decimal={false} value={birthYear} onChange={setBirthYear} />
      <HeightField cm={heightCm} unit={profile.lengthUnit} onChange={setHeightCm} />
      <div className="field-row">
        <NumberField label="Start weight" suffix={u} value={start} onChange={setStart} />
        <NumberField label="Target weight" suffix={u} value={target} onChange={setTarget} placeholder="—" />
      </div>

      <div className="field">
        <label htmlFor="goal">Goal</label>
        <div className="input-wrap">
          <select id="goal" value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>
            {(Object.keys(GOALS) as Goal[]).map((g) => (
              <option key={g} value={g}>
                {GOALS[g].label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="activity">Activity level</label>
        <div className="input-wrap">
          <select id="activity" value={activity} onChange={(e) => setActivity(e.target.value as ActivityLevel)}>
            {(Object.keys(ACTIVITY_LEVELS) as ActivityLevel[]).map((a) => (
              <option key={a} value={a}>
                {ACTIVITY_LEVELS[a].label} — {ACTIVITY_LEVELS[a].hint}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button className="btn btn-primary btn-lg btn-block" disabled={!valid} onClick={() => void save()}>
        Save
      </button>
    </main>
  );
}
