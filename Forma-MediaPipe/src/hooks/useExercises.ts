/**
 * Custom hook for exercise data management
 */

import { useState, useEffect, useCallback } from 'react';
import { exercisesService, Exercise, MuscleGroup } from '../services/api';

interface UseExercisesReturn {
  exercises: Exercise[];
  muscleGroups: MuscleGroup[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  filterByMuscleGroup: (muscleGroup: string) => Exercise[];
}

export const useExercises = (): UseExercisesReturn => {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [exercisesResponse, muscleGroupsResponse] = await Promise.all([
        exercisesService.getAll(),
        exercisesService.getMuscleGroups(),
      ]);

      if (exercisesResponse.success && muscleGroupsResponse.success) {
        setExercises(exercisesResponse.data);
        setMuscleGroups(muscleGroupsResponse.data);
      } else {
        setError('Failed to fetch exercises data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filterByMuscleGroup = useCallback(
    (muscleGroup: string): Exercise[] => {
      if (muscleGroup === 'all') {
        return exercises;
      }
      return exercises.filter(ex => ex.muscleGroup === muscleGroup);
    },
    [exercises]
  );

  return { exercises, muscleGroups, isLoading, error, refetch: fetchData, filterByMuscleGroup };
};
