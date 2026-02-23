/**
 * Mock exercise data – 10 exercises only for the app
 */

import { MuscleGroup, Exercise } from '../../api/types';

export const mockMuscleGroups: MuscleGroup[] = [
  { id: 'all', name: 'All', icon: '' },
  { id: 'chest', name: 'Chest', icon: '' },
  { id: 'back', name: 'Back', icon: '' },
  { id: 'shoulders', name: 'Shoulders', icon: '' },
  { id: 'biceps', name: 'Biceps', icon: '' },
  { id: 'triceps', name: 'Triceps', icon: '' },
  { id: 'legs', name: 'Legs', icon: '' },
  { id: 'core', name: 'Core', icon: '' },
];

export const mockExercises: Exercise[] = [
  { name: 'Push-Up', muscleGroup: 'chest', category: 'Calisthenics' },
  { name: 'Cable Pushdowns', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Barbell Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  { name: 'Machine Ab Crunches', muscleGroup: 'core', category: 'Weightlifting' },
  { name: 'Barbell Squat', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Leg Extensions', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Lying Leg Curl', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Cable Lat Pulldowns', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Standing Dumbbell Lateral Raises', muscleGroup: 'shoulders', category: 'Weightlifting' },
  { name: 'Cable Row', muscleGroup: 'back', category: 'Weightlifting' },
];
