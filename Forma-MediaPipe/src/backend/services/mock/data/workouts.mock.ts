/**
 * Mock workout data – exercises limited to the 10 supported in the app
 */

import { WorkoutSession, WorkoutDetails } from '../../api/types';

export const mockWorkoutSessions: WorkoutSession[] = [
  {
    id: '1',
    name: 'Push Day - Strength',
    date: 'Oct 24',
    fullDate: new Date(2024, 9, 24),
    duration: '45 min',
    totalSets: 15,
    totalReps: 120,
    formScore: 87,
  },
  {
    id: '2',
    name: 'Leg Hypertrophy',
    date: 'Oct 22',
    fullDate: new Date(2024, 9, 22),
    duration: '60 min',
    totalSets: 18,
    totalReps: 210,
    formScore: 85,
  },
  {
    id: '3',
    name: 'Full Body Circuit',
    date: 'Oct 20',
    fullDate: new Date(2024, 9, 20),
    duration: '35 min',
    totalSets: 12,
    totalReps: 300,
    formScore: 82,
  },
  {
    id: '4',
    name: 'Morning Mobility',
    date: 'Oct 18',
    fullDate: new Date(2024, 9, 18),
    duration: '20 min',
    totalSets: 8,
    totalReps: 50,
    formScore: 75,
  },
  {
    id: '5',
    name: 'Upper Body Focus',
    date: 'Sep 15',
    fullDate: new Date(2024, 8, 15),
    duration: '50 min',
    totalSets: 16,
    totalReps: 180,
    formScore: 90,
  },
  {
    id: '6',
    name: 'Cardio Blast',
    date: 'Sep 10',
    fullDate: new Date(2024, 8, 10),
    duration: '30 min',
    totalSets: 10,
    totalReps: 200,
    formScore: 78,
  },
];

export const mockWorkoutDetails: { [key: string]: WorkoutDetails } = {
  '1': {
    id: '1',
    name: 'Push Day - Strength',
    date: 'Oct 24',
    duration: '45 min',
    notes: 'Felt strong today. Increased cable pushdown weight by 5 lbs. Left shoulder was slightly tight on lateral raises — focus on controlled descent next session.',
    exercises: [
      {
        id: '1',
        name: 'Push-Up',
        sets: [
          { setNumber: 1, reps: 12, weight: 0, formScore: 88 },
          { setNumber: 2, reps: 12, weight: 0, formScore: 87 },
          { setNumber: 3, reps: 10, weight: 0, formScore: 85 },
        ],
      },
      {
        id: '2',
        name: 'Cable Pushdowns',
        sets: [
          { setNumber: 1, reps: 12, weight: 50, formScore: 90 },
          { setNumber: 2, reps: 10, weight: 50, formScore: 89 },
          { setNumber: 3, reps: 10, weight: 50, formScore: 88 },
        ],
      },
      {
        id: '3',
        name: 'Standing Dumbbell Lateral Raises',
        sets: [
          { setNumber: 1, reps: 10, weight: 15, formScore: 85 },
          { setNumber: 2, reps: 10, weight: 15, formScore: 84 },
          { setNumber: 3, reps: 8, weight: 15, formScore: 83 },
        ],
      },
    ],
  },
  '2': {
    id: '2',
    name: 'Leg Hypertrophy',
    date: 'Oct 22',
    duration: '60 min',
    exercises: [
      {
        id: '1',
        name: 'Barbell Squat',
        sets: [
          { setNumber: 1, reps: 12, weight: 185, formScore: 82 },
          { setNumber: 2, reps: 12, weight: 185, formScore: 83 },
          { setNumber: 3, reps: 10, weight: 185, formScore: 84 },
          { setNumber: 4, reps: 10, weight: 185, formScore: 85 },
        ],
      },
      {
        id: '2',
        name: 'Leg Extensions',
        sets: [
          { setNumber: 1, reps: 12, weight: 120, formScore: 88 },
          { setNumber: 2, reps: 12, weight: 120, formScore: 87 },
          { setNumber: 3, reps: 10, weight: 120, formScore: 89 },
        ],
      },
      {
        id: '3',
        name: 'Lying Leg Curl',
        sets: [
          { setNumber: 1, reps: 12, weight: 90, formScore: 80 },
          { setNumber: 2, reps: 12, weight: 90, formScore: 81 },
          { setNumber: 3, reps: 10, weight: 90, formScore: 82 },
        ],
      },
    ],
  },
  '3': {
    id: '3',
    name: 'Full Body Circuit',
    date: 'Oct 20',
    duration: '35 min',
    exercises: [
      {
        id: '1',
        name: 'Barbell Curl',
        sets: [
          { setNumber: 1, reps: 10, weight: 65, formScore: 85 },
          { setNumber: 2, reps: 10, weight: 65, formScore: 86 },
          { setNumber: 3, reps: 8, weight: 65, formScore: 84 },
        ],
      },
      {
        id: '2',
        name: 'Cable Lat Pulldowns',
        sets: [
          { setNumber: 1, reps: 10, weight: 100, formScore: 88 },
          { setNumber: 2, reps: 8, weight: 100, formScore: 87 },
          { setNumber: 3, reps: 8, weight: 100, formScore: 86 },
        ],
      },
      {
        id: '3',
        name: 'Cable Row',
        sets: [
          { setNumber: 1, reps: 12, weight: 80, formScore: 82 },
          { setNumber: 2, reps: 10, weight: 80, formScore: 83 },
          { setNumber: 3, reps: 10, weight: 80, formScore: 84 },
        ],
      },
    ],
  },
  '4': {
    id: '4',
    name: 'Morning Mobility',
    date: 'Oct 18',
    duration: '20 min',
    exercises: [
      {
        id: '1',
        name: 'Machine Ab Crunches',
        sets: [
          { setNumber: 1, reps: 15, weight: 0, formScore: 75 },
          { setNumber: 2, reps: 15, weight: 0, formScore: 76 },
        ],
      },
      {
        id: '2',
        name: 'Push-Up',
        sets: [
          { setNumber: 1, reps: 10, weight: 0, formScore: 78 },
          { setNumber: 2, reps: 10, weight: 0, formScore: 79 },
        ],
      },
    ],
  },
  '5': {
    id: '5',
    name: 'Upper Body Focus',
    date: 'Sep 15',
    duration: '50 min',
    exercises: [
      {
        id: '1',
        name: 'Cable Row',
        sets: [
          { setNumber: 1, reps: 8, weight: 120, formScore: 90 },
          { setNumber: 2, reps: 8, weight: 120, formScore: 91 },
          { setNumber: 3, reps: 6, weight: 120, formScore: 89 },
        ],
      },
      {
        id: '2',
        name: 'Cable Lat Pulldowns',
        sets: [
          { setNumber: 1, reps: 10, weight: 100, formScore: 88 },
          { setNumber: 2, reps: 10, weight: 100, formScore: 87 },
          { setNumber: 3, reps: 8, weight: 100, formScore: 89 },
        ],
      },
    ],
  },
  '6': {
    id: '6',
    name: 'Cardio Blast',
    date: 'Sep 10',
    duration: '30 min',
    exercises: [
      {
        id: '1',
        name: 'Push-Up',
        sets: [
          { setNumber: 1, reps: 25, weight: 0, formScore: 78 },
        ],
      },
      {
        id: '2',
        name: 'Machine Ab Crunches',
        sets: [
          { setNumber: 1, reps: 30, weight: 0, formScore: 80 },
        ],
      },
    ],
  },
};
