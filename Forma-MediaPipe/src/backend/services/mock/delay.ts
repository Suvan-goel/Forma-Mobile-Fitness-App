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
