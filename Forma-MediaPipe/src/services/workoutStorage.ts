// Simple in-memory storage for workouts (frontend only)
// In a real app, this would use AsyncStorage or a database

export interface SavedWorkout {
  id: string;
  name: string;
  description?: string;
  category: string;
  date: string;
  fullDate: Date;
  duration: string;
  totalSets: number;
  totalReps: number;
  formScore: number;
}

let workouts: SavedWorkout[] = [];

export const saveWorkout = (workout: Omit<SavedWorkout, 'id' | 'date' | 'fullDate'>): SavedWorkout => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  
  const savedWorkout: SavedWorkout = {
    ...workout,
    id: Date.now().toString(),
    date: dateStr,
    fullDate: now,
  };
  
  workouts.unshift(savedWorkout); // Add to beginning of array (most recent first)
  return savedWorkout;
};

export const getWorkouts = (): SavedWorkout[] => {
  return [...workouts];
};

export const clearWorkouts = () => {
  workouts = [];
};



