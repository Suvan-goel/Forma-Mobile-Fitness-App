/**
 * Mock trainer data extracted from TrainerScreen
 */

import { Recommendation, TrainerProgress, WorkoutSession } from '../../api/types';
import { mockWorkoutSessions } from './workouts.mock';

/**
 * Calculate progress insights from workout data
 */
export const calculateProgress = (workouts: WorkoutSession[] = mockWorkoutSessions): TrainerProgress => {
  const recentWorkouts = workouts.slice(0, 4);
  const olderWorkouts = workouts.slice(4);

  const avgFormRecent = recentWorkouts.reduce((sum, w) => sum + w.formScore, 0) / recentWorkouts.length;
  const avgFormOlder = olderWorkouts.length > 0
    ? olderWorkouts.reduce((sum, w) => sum + w.formScore, 0) / olderWorkouts.length
    : avgFormRecent;

  const totalReps = recentWorkouts.reduce((sum, w) => sum + w.totalReps, 0);
  const avgDuration = recentWorkouts.reduce((sum, w) => {
    const mins = parseInt(w.duration.replace(' min', ''));
    return sum + mins;
  }, 0) / recentWorkouts.length;

  const formTrend = avgFormRecent - avgFormOlder;

  return {
    avgFormScore: Math.round(avgFormRecent),
    formTrend,
    totalReps,
    avgDuration: Math.round(avgDuration),
    workoutCount: recentWorkouts.length,
  };
};

/**
 * Generate AI recommendations based on progress
 */
export const generateRecommendations = (progress: TrainerProgress): Recommendation[] => {
  const recommendations: Recommendation[] = [];

  if (progress.formTrend < 0) {
    recommendations.push({
      type: 'warning',
      title: 'Form Score Declining',
      message: 'Your form scores have decreased recently. Focus on proper technique and consider reducing weight to maintain form.',
    });
  } else if (progress.formTrend > 0) {
    recommendations.push({
      type: 'success',
      title: 'Form Improving',
      message: 'Great job! Your form scores are trending upward. Keep focusing on technique.',
    });
  }

  if (progress.avgFormScore < 80) {
    recommendations.push({
      type: 'warning',
      title: 'Form Needs Attention',
      message: 'Your average form score is below 80. Consider working with lighter weights or focusing on form drills.',
    });
  }

  if (progress.workoutCount < 3) {
    recommendations.push({
      type: 'info',
      title: 'Increase Frequency',
      message: "You've been training less frequently. Aim for at least 3-4 workouts per week for optimal progress.",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      type: 'success',
      title: 'On Track',
      message: "You're making excellent progress! Keep up the consistent training.",
    });
  }

  return recommendations;
};

/**
 * Generate AI response based on user message
 */
export const generateAIResponse = (userMessage: string, progress: TrainerProgress): string => {
  const lowerMessage = userMessage.toLowerCase();

  // Form-related questions
  if (lowerMessage.includes('form') || lowerMessage.includes('technique')) {
    if (progress.avgFormScore < 80) {
      return `Based on your recent workouts, your average form score is ${progress.avgFormScore}%, which is below optimal. I recommend focusing on proper technique by:\n\n1. Reducing weight by 10-15% to perfect form\n2. Recording yourself to identify form issues\n3. Slowing down your reps to maintain control\n\nYour form has ${progress.formTrend > 0 ? 'improved' : 'declined'} recently, so let's get it back on track!`;
    }
    return `Your form scores are looking good at ${progress.avgFormScore}% average! Keep focusing on controlled movements and full range of motion. Your form has been ${progress.formTrend > 0 ? 'improving' : 'stable'} recently.`;
  }

  // Progress questions
  if (lowerMessage.includes('progress') || lowerMessage.includes('improve') || lowerMessage.includes('better')) {
    const formTrend = progress.formTrend > 0 ? 'improving' : progress.formTrend < 0 ? 'declining' : 'stable';
    return `Here's your progress overview:\n\n📊 Form Score: ${progress.avgFormScore}% (${formTrend})\n🏋️ Total Reps (recent): ${progress.totalReps}\n⏱️ Avg Duration: ${progress.avgDuration} min\n\n${progress.formTrend > 0 ? "You're making great progress! Keep it up!" : 'Focus on maintaining consistent form to see better results.'}`;
  }

  // Workout frequency
  if (lowerMessage.includes('frequency') || lowerMessage.includes('often') || lowerMessage.includes('times')) {
    return `You've completed ${progress.workoutCount} workouts recently. For optimal progress, aim for 3-4 workouts per week. ${progress.workoutCount < 3 ? 'Try to increase your training frequency!' : "You're on track with your frequency!"}`;
  }

  // Nutrition questions
  if (lowerMessage.includes('nutrition') || lowerMessage.includes('diet') || lowerMessage.includes('eat') || lowerMessage.includes('food')) {
    return `Here are my nutrition recommendations:\n\n1. Protein: Aim for 0.8-1g per lb of bodyweight daily\n2. Carbs: Focus on complex carbs pre-workout for energy\n3. Hydration: Drink 0.5-1L water during workouts\n4. Recovery: Post-workout meal within 30-60 minutes\n\nProper nutrition supports recovery and performance!`;
  }

  // Recovery questions
  if (lowerMessage.includes('recovery') || lowerMessage.includes('rest') || lowerMessage.includes('sleep')) {
    return `Recovery is crucial for your progress! Based on your ${progress.avgDuration}-minute average workout duration:\n\n1. Sleep: Aim for 7-9 hours nightly\n2. Rest Days: Take 1-2 rest days between intense sessions\n3. Active Recovery: Light walks or stretching on rest days\n4. Hydration: Stay hydrated throughout the day\n\nWith your current training intensity, proper recovery will maximize your gains!`;
  }

  // General fitness advice
  if (lowerMessage.includes('workout') || lowerMessage.includes('exercise') || lowerMessage.includes('routine')) {
    return `Based on your workout history, I see you're doing a mix of strength and cardio. Here's what I recommend:\n\n1. Continue your current split (Push, Legs, Full Body)\n2. Add 1-2 mobility sessions per week (like your Morning Mobility)\n3. Focus on progressive overload - gradually increase weight or reps\n4. Track your form scores to ensure quality over quantity\n\nYour recent workouts show good variety - keep it up!`;
  }

  // Default response
  return `I'm here to help with your fitness journey! Based on your recent workouts:\n\n• Average Form: ${progress.avgFormScore}%\n• Recent Workouts: ${progress.workoutCount}\n\nYou can ask me about:\n- Form and technique\n- Progress tracking\n- Nutrition\n- Recovery\n- Workout planning\n\nWhat would you like to know?`;
};
