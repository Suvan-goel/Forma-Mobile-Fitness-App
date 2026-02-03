/**
 * Network simulation utilities for mock API layer
 */

/**
 * Simulates network delay
 * @param ms Delay in milliseconds (default 300ms)
 */
export const mockDelay = (ms: number = 300): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Simulates network delay with random variation
 * @param min Minimum delay in milliseconds
 * @param max Maximum delay in milliseconds
 */
export const mockDelayRange = (min: number, max: number): Promise<void> => {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return mockDelay(delay);
};
