import { builtInId } from './exercises';

/** Starter programmes. Creating one copies it into the user's own routines (fully editable). */
export interface TemplateExercise {
  name: string;
  sets: number;
  reps: [number, number];
  rest: number;
  warmups?: number;
}

export interface ProgrammeTemplate {
  id: string;
  name: string;
  daysPerWeek: string;
  description: string;
  routines: { name: string; exercises: TemplateExercise[] }[];
}

const ex = (name: string, sets: number, reps: [number, number], rest = 90, warmups = 0): TemplateExercise => ({
  name,
  sets,
  reps,
  rest,
  warmups,
});

export const TEMPLATES: ProgrammeTemplate[] = [
  {
    id: 'ppl',
    name: 'Push / Pull / Legs',
    daysPerWeek: '3–6 days',
    description: 'Classic split. Run it once (3 days) or twice (6 days) a week.',
    routines: [
      {
        name: 'Push',
        exercises: [
          ex('Bench Press', 3, [6, 8], 150, 2),
          ex('Overhead Press', 3, [6, 10], 120, 1),
          ex('Incline Dumbbell Press', 3, [8, 12], 90),
          ex('Lateral Raise', 3, [12, 15], 60),
          ex('Tricep Pushdown', 3, [10, 12], 60),
        ],
      },
      {
        name: 'Pull',
        exercises: [
          ex('Lat Pulldown', 3, [6, 8], 120, 1),
          ex('Barbell Row', 3, [6, 10], 120, 1),
          ex('Seated Cable Row', 3, [8, 12], 90),
          ex('Face Pull', 3, [12, 15], 60),
          ex('Dumbbell Curl', 3, [10, 12], 60),
        ],
      },
      {
        name: 'Legs',
        exercises: [
          ex('Squat', 3, [5, 8], 180, 2),
          ex('Romanian Deadlift', 3, [8, 10], 120, 1),
          ex('Leg Press', 3, [10, 12], 120),
          ex('Lying Leg Curl', 3, [10, 12], 90),
          ex('Standing Calf Raise', 3, [10, 15], 60),
        ],
      },
    ],
  },
  {
    id: 'upper-lower',
    name: 'Upper / Lower',
    daysPerWeek: '4 days',
    description: 'Each muscle twice a week. Great for steady strength and size.',
    routines: [
      {
        name: 'Upper A',
        exercises: [
          ex('Bench Press', 3, [5, 8], 150, 2),
          ex('Barbell Row', 3, [6, 10], 120, 1),
          ex('Seated Dumbbell Press', 3, [8, 10], 90),
          ex('Lat Pulldown', 3, [8, 12], 90),
          ex('Barbell Curl', 2, [10, 12], 60),
          ex('Tricep Pushdown', 2, [10, 12], 60),
        ],
      },
      {
        name: 'Lower A',
        exercises: [
          ex('Squat', 3, [5, 8], 180, 2),
          ex('Romanian Deadlift', 3, [8, 10], 120, 1),
          ex('Leg Extension', 3, [10, 15], 60),
          ex('Seated Leg Curl', 3, [10, 12], 60),
          ex('Standing Calf Raise', 3, [10, 15], 60),
        ],
      },
      {
        name: 'Upper B',
        exercises: [
          ex('Overhead Press', 3, [5, 8], 150, 1),
          ex('Pull-up', 3, [6, 10], 120),
          ex('Incline Dumbbell Press', 3, [8, 12], 90),
          ex('Chest-Supported Row', 3, [8, 12], 90),
          ex('Lateral Raise', 3, [12, 15], 60),
        ],
      },
      {
        name: 'Lower B',
        exercises: [
          ex('Deadlift', 3, [3, 5], 180, 2),
          ex('Leg Press', 3, [8, 12], 120),
          ex('Bulgarian Split Squat', 3, [8, 10], 90),
          ex('Lying Leg Curl', 3, [10, 12], 60),
          ex('Hanging Leg Raise', 3, [10, 15], 60),
        ],
      },
    ],
  },
  {
    id: 'full-body',
    name: 'Full Body',
    daysPerWeek: '3 days',
    description: 'Whole body every session. Ideal for beginners or busy weeks.',
    routines: [
      {
        name: 'Full Body A',
        exercises: [
          ex('Squat', 3, [5, 8], 150, 2),
          ex('Bench Press', 3, [5, 8], 150, 1),
          ex('Barbell Row', 3, [8, 10], 90),
          ex('Lateral Raise', 2, [12, 15], 60),
        ],
      },
      {
        name: 'Full Body B',
        exercises: [
          ex('Deadlift', 3, [3, 5], 180, 2),
          ex('Overhead Press', 3, [6, 8], 120, 1),
          ex('Lat Pulldown', 3, [8, 12], 90),
          ex('Dumbbell Curl', 2, [10, 12], 60),
        ],
      },
    ],
  },
];

/** Every template exercise must exist in the built-in library. */
export const templateExerciseId = (name: string) => builtInId(name);
