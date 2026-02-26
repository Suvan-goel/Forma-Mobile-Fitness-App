export type TrainerGender = 'female' | 'male';

export interface Trainer {
  id: string;
  name: string;
  age: number;
  specialty: string;
  description: string;
  gender: TrainerGender;
  voiceId: string;
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
    voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel
    greeting: 'Hi, I\'m Maya. We\'re going to slow everything down, feel every rep, and build with real intention. Excited to work with you.',
  },
  {
    id: 'jess',
    name: 'Jess',
    age: 28,
    specialty: 'Powerlifting & Strength',
    description: 'Competitive powerlifter turned coach. Jess lives for PRs. She\'ll hype you up for heavy sets and make sure you leave nothing in the tank.',
    gender: 'female',
    voiceId: 'AZnzlk1XvdvUeBnXmlld', // Domi
    greeting: 'Jess here. We lift heavy, we chase PRs, and we leave nothing on the floor. Let\'s get to work.',
  },
  {
    id: 'sofia',
    name: 'Sofia',
    age: 34,
    specialty: 'Strength & Programming',
    description: 'Exercise science background applied to progressive overload. Sofia tracks your numbers, optimises your splits, and keeps your gains on an upward trajectory.',
    gender: 'female',
    voiceId: 'EXAVITQu4vr4xnSDxMaL', // Bella
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
    voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam
    greeting: 'Marcus. We squat, we bench, we deadlift. No fluff, no excuses. Let\'s get under the bar.',
  },
  {
    id: 'jake',
    name: 'Jake',
    age: 30,
    specialty: 'Functional Strength',
    description: 'Former athlete who transitioned into gym coaching. Jake combines explosive lifting with solid fundamentals to build strength you can actually use.',
    gender: 'male',
    voiceId: 'ErXwobaYiN019PkySvjV', // Antoni
    greeting: 'Jake here. We\'re going to move some serious weight and build strength you can actually use. Ready? Let\'s go.',
  },
  {
    id: 'owen',
    name: 'Owen',
    age: 37,
    specialty: 'Corrective Lifting & Form',
    description: 'Started in physical therapy, now coaches form-first lifting. Owen will flag every technique fault before it becomes an injury, so you can lift heavy for years.',
    gender: 'male',
    voiceId: 'VR6AewLTigWG4xSOukaG', // Arnold
    greeting: 'Hey, I\'m Owen. We\'re going to build strength the right way — solid form, smart progression, no shortcuts. You\'re in good hands.',
  },
];

export const DEFAULT_TRAINER_ID = 'marcus';
