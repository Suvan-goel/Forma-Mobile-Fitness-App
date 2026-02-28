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
    specialty: 'Training for muscle tone & confidence',
    description: 'Maya began weightlifting during university and fell in love with how it built confidence beyond the gym. She specialises in helping clients feel strong and capable, especially beginners who feel intimidated by the weights area.',
    gender: 'female',
    voiceId: 'SAz9YHcvj6GT2YYXdXww', // Rachel
    voiceSettings: { speed: 0.9, stability: 0.5, similarity: 0.8, styleExaggeration: 0.1 },
    greeting: 'Hi, I\'m Maya. Lift with confidence and intention. Strong, controlled movement builds lasting results',
  },
  {
    id: 'jess',
    name: 'Jess',
    age: 27,
    specialty: 'Lower body strength & hypertrophy',
    description: 'Jess built a large online following teaching proper lower-body mechanics and glute training. She\'s passionate about teaching proper hip hinge technique and eliminating ego lifting.',
    gender: 'female',
    voiceId: 'FGY2WhTYpPnrIDTdsKH5', // Domi
    voiceSettings: { speed: 1.05, stability: 0.4, similarity: 0.8, styleExaggeration: 0.3 },
    greeting: 'Hey, I\'m Jess. Stay controlled, stay powerful, and make every rep count. Let\'s build real strength',
  },
  {
    id: 'sofia',
    name: 'Sofia',
    age: 35,
    specialty: 'Biomechanics & injury-preventive strength',
    description: 'Sofia holds a PhD in Biomechanics and worked in sports rehabilitation before transitioning into strength coaching. She blends scientific explanation with practical cues.',
    gender: 'female',
    voiceId: 'Xb7hH8MSUJpSbSDYk0k2', // Bella
    voiceSettings: { speed: 1.0, stability: 0.55, similarity: 0.8, styleExaggeration: 0.1 },
    greeting: 'Hello, I\'m Sofia. Clean movement creates sustainable strength. Train smart, and progress follows',
  },
  // Male trainers
  {
    id: 'marcus',
    name: 'Marcus',
    age: 34,
    specialty: 'Strength & Hypertrophy',
    description: 'Marcus competed in regional powerlifting competitions in his 20s before transitioning into coaching. He holds a degree in Sports Science and has coached over 300 clients in strength transformation programs. He’s obsessed with perfect bar path, controlled eccentrics, and measurable progression.',
    gender: 'male',
    voiceId: 'iP95p4xoKVk53GoZ742B', // Chris
    voiceSettings: { speed: 0.95, stability: 0.6, similarity: 0.8, styleExaggeration: 0.05 },
    greeting: 'I\'m Marcus. We build real strength through control and precision. Focus on every rep — the results will come.',
  },
  {
    id: 'jake',
    name: 'Jake',
    age: 29,
    specialty: 'Lean muscle & athletic conditioning',
    description: 'Jake grew up playing football and transitioned into strength training after a knee injury ended his competitive career. He now focuses on functional strength, explosive training, and building aesthetic, athletic physiques.',
    gender: 'male',
    voiceId: 'bIHbv24MWmeRgasZH58o', // Will
    voiceSettings: { speed: 1.05, stability: 0.45, similarity: 0.8, styleExaggeration: 0.25 },
    greeting: 'Hi, I\'m Jake. Train with energy, move with purpose, and improve every session. Let\'s get to work.',
  },
  {
    id: 'owen',
    name: 'Owen',
    age: 37,
    specialty: 'Advanced strength & body recomposition',
    description: 'Owen started lifting at 16 and has trained consistently for over 20 years. After transforming his own physique dramatically in his early 30s, he became a coach specialising in sustainable fat loss and muscle retention.',
    gender: 'male',
    voiceId: 'TX3LPaxmHKxFdv7VOQHJ', // Liam
    voiceSettings: { speed: 0.9, stability: 0.6, similarity: 0.8, styleExaggeration: 0.1 },
    greeting: 'Hey, I\'m Owen. Discipline drives progress. Stay focused, commit to the reps, and we\'ll build real strength',
  },
];

export const DEFAULT_TRAINER_ID = 'marcus';
