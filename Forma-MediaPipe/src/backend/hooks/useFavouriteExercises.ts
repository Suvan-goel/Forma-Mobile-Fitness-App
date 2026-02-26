import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FAVOURITES_KEY = '@forma/favourite_exercises';

interface UseFavouriteExercisesReturn {
  favouriteNames: string[];
  isFavourite: (name: string) => boolean;
  toggleFavourite: (name: string) => void;
}

export const useFavouriteExercises = (): UseFavouriteExercisesReturn => {
  const [favouriteNames, setFavouriteNames] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(FAVOURITES_KEY).then(json => {
      if (json) {
        try {
          setFavouriteNames(JSON.parse(json));
        } catch {
          // corrupted storage — ignore and start fresh
        }
      }
    });
  }, []);

  const toggleFavourite = useCallback((name: string) => {
    setFavouriteNames(prev => {
      const next = prev.includes(name)
        ? prev.filter(n => n !== name)
        : [...prev, name];
      AsyncStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isFavourite = useCallback(
    (name: string) => favouriteNames.includes(name),
    [favouriteNames],
  );

  return { favouriteNames, isFavourite, toggleFavourite };
};
