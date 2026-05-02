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
    voiceId: '8N2ng9i2uiUWqstgmWlH',
    voiceSettings: { speed: 0.96, stability: 0.56, similarity: 0.86, styleExaggeration: 0.08 },
    greeting: "Hey, I'm Maya. I'm glad you're here. Take the first few reps easy, find your rhythm, and I'll keep you moving well.",
  },
  {
    id: 'jess',
    name: 'Jess',
    age: 27,
    specialty: 'Lower body strength & hypertrophy',
    description: 'Jess built a large online following teaching proper lower-body mechanics and glute training. She\'s passionate about teaching proper hip hinge technique and eliminating ego lifting.',
    gender: 'female',
    voiceId: 'l4Coq6695JDX9xtLqXDE',
    voiceSettings: { speed: 1.07, stability: 0.48, similarity: 0.84, styleExaggeration: 0.18 },
    greeting: "Hey, I'm Jess. Let's settle in, get strong, and make these reps count. I'll nudge you when something needs cleaning up.",
  },
  {
    id: 'sofia',
    name: 'Sofia',
    age: 35,
    specialty: 'Biomechanics & injury-preventive strength',
    description: 'Sofia holds a PhD in Biomechanics and worked in sports rehabilitation before transitioning into strength coaching. She blends scientific explanation with practical cues.',
    gender: 'female',
    voiceId: 'uJCs8Cm3vdGWEkXI6wUX',
    voiceSettings: { speed: 0.98, stability: 0.64, similarity: 0.88, styleExaggeration: 0.04 },
    greeting: "Hi, I'm Sofia. We'll keep this smart and steady. Move well first, then we can build from there.",
  },
  // Male trainers
  {
    id: 'marcus',
    name: 'Marcus',
    age: 34,
    specialty: 'Strength & Hypertrophy',
    description: 'Marcus competed in regional powerlifting competitions in his 20s before transitioning into coaching. He holds a degree in Sports Science and has coached over 300 clients in strength transformation programs. He’s obsessed with perfect bar path, controlled eccentrics, and measurable progression.',
    gender: 'male',
    voiceId: 'c6SfcYrb2t09NHXiT80T',
    voiceSettings: { speed: 0.97, stability: 0.62, similarity: 0.87, styleExaggeration: 0.06 },
    greeting: "Hey, I'm Marcus. Good to have you here. Stay controlled, listen for the small fixes, and we'll get some solid work in.",
  },
  {
    id: 'jake',
    name: 'Jake',
    age: 29,
    specialty: 'Lean muscle & athletic conditioning',
    description: 'Jake grew up playing football and transitioned into strength training after a knee injury ended his competitive career. He now focuses on functional strength, explosive training, and building aesthetic, athletic physiques.',
    gender: 'male',
    voiceId: 'l30f87tf05uxyknGdDw6',
    voiceSettings: { speed: 1.08, stability: 0.5, similarity: 0.84, styleExaggeration: 0.16 },
    greeting: "Hey, I'm Jake. Glad you're training today. Bring a bit of energy, and I'll help you keep the reps sharp.",
  },
  {
    id: 'owen',
    name: 'Owen',
    age: 37,
    specialty: 'Advanced strength & body recomposition',
    description: 'Owen started lifting at 16 and has trained consistently for over 20 years. After transforming his own physique dramatically in his early 30s, he became a coach specialising in sustainable fat loss and muscle retention.',
    gender: 'male',
    voiceId: 'MdeqL1TMyZWz86QOELK8',
    voiceSettings: { speed: 0.94, stability: 0.65, similarity: 0.88, styleExaggeration: 0.05 },
    greeting: "Hey, I'm Owen. Let's keep this simple: clean reps, steady effort, and no rushing. I'll talk you through it.",
  },
];

export const DEFAULT_TRAINER_ID = 'marcus';
