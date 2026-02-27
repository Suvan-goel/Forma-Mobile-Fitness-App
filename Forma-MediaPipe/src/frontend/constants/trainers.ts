export type TrainerGender = 'female' | 'male';

export interface TrainerVoiceSettings {
  /** Speech speed multiplier. Range: 0.7–1.2. Default: 1.0 */
  speed: number;
  /** Voice consistency/predictability. Range: 0–1. Higher = more stable/monotone. */
  stability: number;
  /** How closely the output matches the original voice sample. Range: 0–1. */
  similarity: number;
  /** Expressive exaggeration of the voice style. Range: 0–1. Higher = more dramatic. */
  styleExaggeration: number;
}

export interface Trainer {
  id: string;
  name: string;
  age: number;
  specialty: string;
  description: string;
  gender: TrainerGender;
  voiceId: string;
  voiceSettings: TrainerVoiceSettings;
  greeting: string;
}

export const TRAINERS: Trainer[] = [
  // Female trainers
  {
    id: 'maya',
    name: 'Maya',
    age: 31,
    specialty: 'Hypertrophy & Mind-Muscle',
    description: '10+ years of bodybuilding coaching. Maya\'s calm cues help you feel every rep, maximise the squeeze, and build muscle with intention.',
    gender: 'female',
    voiceId: 'SAz9YHcvj6GT2YYXdXww', // Rachel
    voiceSettings: { speed: 0.9, stability: 0.5, similarity: 0.8, styleExaggeration: 0.1 },
    greeting: 'Hi, I\'m Maya. We\'re going to slow everything down, feel every rep, and build with real intention. Excited to work with you.',
  },
  {
    id: 'jess',
    name: 'Jess',
    age: 28,
    specialty: 'Powerlifting & Strength',
    description: 'Competitive powerlifter turned coach. Jess lives for PRs. She\'ll hype you up for heavy sets and make sure you leave nothing in the tank.',
    gender: 'female',
    voiceId: 'FGY2WhTYpPnrIDTdsKH5', // Domi
    voiceSettings: { speed: 1.05, stability: 0.4, similarity: 0.8, styleExaggeration: 0.3 },
    greeting: 'Jess here. We lift heavy, we chase PRs, and we leave nothing on the floor. Let\'s get to work.',
  },
  {
    id: 'sofia',
    name: 'Sofia',
    age: 34,
    specialty: 'Strength & Programming',
    description: 'Exercise science background applied to progressive overload. Sofia tracks your numbers, optimises your splits, and keeps your gains on an upward trajectory.',
    gender: 'female',
    voiceId: 'Xb7hH8MSUJpSbSDYk0k2', // Bella
    voiceSettings: { speed: 1.0, stability: 0.55, similarity: 0.8, styleExaggeration: 0.1 },
    greeting: 'Hi, I\'m Sofia. Smart programming, progressive overload, and data-driven results. We\'ve got a lot of gains ahead of us.',
  },
  // Male trainers
  {
    id: 'marcus',
    name: 'Marcus',
    age: 42,
    specialty: 'Heavy Compound Lifts',
    description: 'Old-school iron game with 15+ years under the bar. Marcus keeps it simple: squat, bench, deadlift, eat, sleep, repeat. No fluff, just results.',
    gender: 'male',
    voiceId: 'iP95p4xoKVk53GoZ742B', // Chris
    voiceSettings: { speed: 0.95, stability: 0.6, similarity: 0.8, styleExaggeration: 0.05 },
    greeting: 'I\'m Marcus. We squat, we bench, we deadlift. No fluff, no excuses. Let\'s get under the bar.',
  },
  {
    id: 'jake',
    name: 'Jake',
    age: 30,
    specialty: 'Functional Strength',
    description: 'Former athlete who transitioned into gym coaching. Jake combines explosive lifting with solid fundamentals to build strength you can actually use.',
    gender: 'male',
    voiceId: 'bIHbv24MWmeRgasZH58o', // Will
    voiceSettings: { speed: 1.05, stability: 0.45, similarity: 0.8, styleExaggeration: 0.25 },
    greeting: 'Jake here. We\'re going to move some serious weight and build strength you can actually use. Ready? Let\'s go.',
  },
  {
    id: 'owen',
    name: 'Owen',
    age: 37,
    specialty: 'Corrective Lifting & Form',
    description: 'Started in physical therapy, now coaches form-first lifting. Owen will flag every technique fault before it becomes an injury, so you can lift heavy for years.',
    gender: 'male',
    voiceId: 'TX3LPaxmHKxFdv7VOQHJ', // Liam
    voiceSettings: { speed: 0.9, stability: 0.6, similarity: 0.8, styleExaggeration: 0.1 },
    greeting: 'Hey, I\'m Owen. We\'re going to build strength the right way — solid form, smart progression, no shortcuts. You\'re in good hands.',
  },
];

export const DEFAULT_TRAINER_ID = 'marcus';
