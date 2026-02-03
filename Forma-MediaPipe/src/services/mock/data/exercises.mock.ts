/**
 * Mock exercise data extracted from ChooseExerciseScreen
 */

import { MuscleGroup, Exercise } from '../../api/types';

export const mockMuscleGroups: MuscleGroup[] = [
  { id: 'all', name: 'All', icon: '💪' },
  { id: 'chest', name: 'Chest', icon: '🫁' },
  { id: 'back', name: 'Back', icon: '🦴' },
  { id: 'shoulders', name: 'Shoulders', icon: '💪' },
  { id: 'biceps', name: 'Biceps', icon: '💪' },
  { id: 'triceps', name: 'Triceps', icon: '💪' },
  { id: 'legs', name: 'Legs', icon: '🦵' },
  { id: 'glutes', name: 'Glutes', icon: '🍑' },
  { id: 'calves', name: 'Calves', icon: '🦵' },
  { id: 'core', name: 'Core', icon: '🫁' },
];

export const mockExercises: Exercise[] = [
  // Chest
  { name: 'Barbell Bench Press', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Incline Dumbbell Press', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Dumbbell Chest Fly (flat or incline)', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Weighted Dips (chest-leaning)', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Cable Fly (mid–low or high–low)', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Push-Ups (standard / deficit / weighted)', muscleGroup: 'chest', category: 'Weightlifting' },
  { name: 'Incline Barbell Bench Press', muscleGroup: 'chest', category: 'Weightlifting' },
  // Back
  { name: 'Deadlift', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Pull-Ups / Weighted Pull-Ups', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Barbell Row', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Lat Pulldown', muscleGroup: 'back', category: 'Weightlifting' },
  { name: 'Seated Cable Row', muscleGroup: 'back', category: 'Weightlifting' },
  // Shoulders (Deltoids)
  { name: 'Overhead Barbell Press', muscleGroup: 'shoulders', category: 'Weightlifting' },
  { name: 'Dumbbell Shoulder Press', muscleGroup: 'shoulders', category: 'Weightlifting' },
  { name: 'Lateral Raises', muscleGroup: 'shoulders', category: 'Weightlifting' },
  { name: 'Rear Delt Fly (dumbbell or cable)', muscleGroup: 'shoulders', category: 'Weightlifting' },
  // Biceps
  { name: 'Barbell Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  { name: 'Incline Dumbbell Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  { name: 'Hammer Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  { name: 'Preacher Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  { name: 'Cable Curl', muscleGroup: 'biceps', category: 'Weightlifting' },
  // Triceps
  { name: 'Close-Grip Bench Press', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Skull Crushers (EZ-bar)', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Cable Pushdowns', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Overhead Triceps Extension', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Weighted Dips', muscleGroup: 'triceps', category: 'Weightlifting' },
  { name: 'Diamond Push-Ups', muscleGroup: 'triceps', category: 'Weightlifting' },
  // Legs (Quads, Hamstrings, Glutes)
  { name: 'Back Squat', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Romanian Deadlift', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Leg Press', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Walking Lunges', muscleGroup: 'legs', category: 'Weightlifting' },
  { name: 'Leg Curl (machine)', muscleGroup: 'legs', category: 'Weightlifting' },
  // Glutes
  { name: 'Barbell Hip Thrust', muscleGroup: 'glutes', category: 'Weightlifting' },
  { name: 'Bulgarian Split Squat', muscleGroup: 'glutes', category: 'Weightlifting' },
  { name: 'Sumo Deadlift', muscleGroup: 'glutes', category: 'Weightlifting' },
  { name: 'Cable Kickbacks', muscleGroup: 'glutes', category: 'Weightlifting' },
  { name: 'Step-Ups', muscleGroup: 'glutes', category: 'Weightlifting' },
  // Calves
  { name: 'Standing Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  { name: 'Seated Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  { name: 'Donkey Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  { name: 'Single-Leg Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  { name: 'Leg Press Calf Raises', muscleGroup: 'calves', category: 'Weightlifting' },
  // Core (Abs & Obliques)
  { name: 'Hanging Leg Raises', muscleGroup: 'core', category: 'Weightlifting' },
  { name: 'Cable Crunches', muscleGroup: 'core', category: 'Weightlifting' },
  { name: 'Ab Wheel Rollouts', muscleGroup: 'core', category: 'Weightlifting' },
  { name: 'Russian Twists (weighted)', muscleGroup: 'core', category: 'Weightlifting' },
  { name: 'Planks (weighted)', muscleGroup: 'core', category: 'Weightlifting' },
];
