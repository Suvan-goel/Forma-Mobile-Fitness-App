/**
 * Mock analytics data extracted from AnalyticsScreen
 */

import { WorkoutBarData } from '../../api/types';

// Base data arrays for each metric (used for time range generation)
export const formBaseData = [72, 75, 78, 82, 80, 85, 87];
export const consistencyBaseData = [65, 70, 68, 72, 75, 78, 79];
export const strengthBaseData = [70, 72, 75, 78, 80, 82, 84];

// Weekly bar chart data
export const mockWeeklyBarData: WorkoutBarData[] = [
  { day: 'Mon', value: 60 },
  { day: 'Tue', value: 80 },
  { day: 'Wed', value: 100 },
  { day: 'Thu', value: 40 },
  { day: 'Fri', value: 70 },
  { day: 'Sat', value: 0 },
  { day: 'Sun', value: 0 },
];

/**
 * Generate data based on time range
 * This mirrors the generateDataForTimeRange function from AnalyticsScreen
 */
export const generateDataForTimeRange = (
  baseData: number[],
  timeRange: string
): { values: number[]; dates: Date[] } => {
  const currentValue = baseData[baseData.length - 1];
  const startValue = baseData[0];

  let numPoints: number;
  let daysBack: number;
  switch (timeRange) {
    case '1 week':
      numPoints = 7;
      daysBack = 7;
      break;
    case '4 weeks':
      numPoints = 28;
      daysBack = 28;
      break;
    case '3 months':
      numPoints = 13;
      daysBack = 91;
      break;
    case '6 months':
      numPoints = 26;
      daysBack = 182;
      break;
    case 'Year':
      numPoints = 52;
      daysBack = 365;
      break;
    default:
      numPoints = 7;
      daysBack = 7;
  }

  const data: number[] = [];
  const dates: Date[] = [];
  const today = new Date();

  for (let i = 0; i < numPoints; i++) {
    const progress = i / (numPoints - 1);
    const baseProgression = startValue + (currentValue - startValue) * progress;
    const waveVariation = Math.sin((i / numPoints) * Math.PI * 6) * 2;
    const trendVariation = Math.sin((i / numPoints) * Math.PI * 2) * 1.5;
    const value = Math.round(baseProgression + waveVariation + trendVariation);
    data.push(Math.max(0, Math.min(100, value)));

    const daysAgo = Math.round(daysBack * (1 - progress));
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    dates.push(date);
  }

  // Ensure the last value matches the current value
  data[data.length - 1] = currentValue;
  dates[dates.length - 1] = today;

  return { values: data, dates };
};
