/**
 * Custom hook for AI trainer data management
 */

import { useState, useEffect, useCallback } from 'react';
import { trainerService, Recommendation, TrainerProgress } from '../services/api';

interface UseTrainerReturn {
  progress: TrainerProgress | null;
  recommendations: Recommendation[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  sendMessage: (message: string) => Promise<string>;
}

export const useTrainer = (): UseTrainerReturn => {
  const [progress, setProgress] = useState<TrainerProgress | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [progressResponse, recommendationsResponse] = await Promise.all([
        trainerService.getProgress(),
        trainerService.getRecommendations(),
      ]);

      if (progressResponse.success && recommendationsResponse.success) {
        setProgress(progressResponse.data);
        setRecommendations(recommendationsResponse.data);
      } else {
        setError('Failed to fetch trainer data');
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

  const sendMessage = useCallback(async (message: string): Promise<string> => {
    try {
      const response = await trainerService.getAIResponse(message);
      if (response.success) {
        return response.data;
      }
      return 'Sorry, I could not process your message. Please try again.';
    } catch (err) {
      return 'An error occurred while processing your message.';
    }
  }, []);

  return { progress, recommendations, isLoading, error, refetch: fetchData, sendMessage };
};
