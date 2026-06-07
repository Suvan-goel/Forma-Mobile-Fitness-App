export interface TrainerVoiceSettings {
  /** Speech speed multiplier. Range: 0.7-1.2. Default: 1.0 */
  speed: number;
  /** Voice consistency/predictability. Range: 0-1. Higher = more stable/monotone. */
  stability: number;
  /** How closely the output matches the original voice sample. Range: 0-1. */
  similarity: number;
  /** Expressive exaggeration of the voice style. Range: 0-1. Higher = more dramatic. */
  styleExaggeration: number;
}

export interface Trainer {
  id: string;
  name: string;
  description: string;
  voiceId: string;
  voiceSettings: TrainerVoiceSettings;
  previewGreeting?: string;
  greeting: string;
}

export const TRAINERS: Trainer[] = [
  {
    id: 'ava',
    name: 'Ava',
    description: 'Warm, relaxed, and friendly, with an easygoing coaching style.',
    voiceId: '56bWURjYFHyYyVf490Dp',
    voiceSettings: { speed: 0.96, stability: 0.55, similarity: 0.8, styleExaggeration: 0 },
    greeting: "Hey, I'm Ava. Let's get started.",
  },
  {
    id: 'isla',
    name: 'Isla',
    description: 'Clear, calm, and polished, making guidance easy to follow.',
    voiceId: 'rfkTsdZrVWEVhDycUYn9',
    voiceSettings: { speed: 0.96, stability: 0.6, similarity: 0.8, styleExaggeration: 0 },
    greeting: "Hi, I'm Isla. I'll guide you through it.",
  },
  {
    id: 'naomi',
    name: 'Naomi',
    description: 'Smooth, confident, and composed, with a premium coaching feel.',
    voiceId: '19STyYD15bswVz51nqLf',
    voiceSettings: { speed: 0.94, stability: 0.6, similarity: 0.8, styleExaggeration: 0 },
    greeting: "I'm Naomi. Let's train with control.",
  },
  {
    id: 'clara',
    name: 'Clara',
    description: 'Reassuring, supportive, and trustworthy, with a calm presence.',
    voiceId: 'qSeXEcewz7tA0Q0qk9fH',
    voiceSettings: { speed: 0.9, stability: 0.58, similarity: 0.78, styleExaggeration: 0 },
    greeting: "Hi, I'm Clara. You've got this.",
  },
  {
    id: 'malik',
    name: 'Malik',
    description: 'Natural, upbeat, and charismatic, bringing energy without feeling forced.',
    voiceId: 'VlUmeC1Uzj3NnwiVR9K9',
    voiceSettings: { speed: 1.01, stability: 0.48, similarity: 0.78, styleExaggeration: 0 },
    greeting: "Yo, I'm Malik. Let's get moving.",
  },
  {
    id: 'leo',
    name: 'Leo',
    description: 'Focused, professional, and composed, with a strong coach-like presence.',
    voiceId: 'lUTamkMw7gOzZbFIwmq4',
    voiceSettings: { speed: 0.94, stability: 0.62, similarity: 0.82, styleExaggeration: 0 },
    greeting: "I'm Leo. Stay focused, let's work.",
  },
  {
    id: 'miles',
    name: 'Miles',
    description: 'Casual, direct, and motivating, with a realistic personal-trainer feel.',
    voiceId: '1t1EeRixsJrKbiF1zwM6',
    voiceSettings: { speed: 0.98, stability: 0.52, similarity: 0.78, styleExaggeration: 0 },
    greeting: "Hey, I'm Miles. Let's get after it.",
  },
  {
    id: 'theo',
    name: 'Theo',
    description: 'Dynamic, energetic, and natural, with a slightly gritty coaching style.',
    voiceId: 'xYo5z1CSHgIA8XSPGcsR',
    voiceSettings: { speed: 0.99, stability: 0.48, similarity: 0.78, styleExaggeration: 0 },
    greeting: "I'm Theo. Let's make this count.",
  },
];

export const DEFAULT_TRAINER_ID = 'ava';
