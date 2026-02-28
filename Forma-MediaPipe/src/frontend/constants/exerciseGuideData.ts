export interface ExerciseSetupData {
  keySetup: string;
  reasonText: string;
  cameraTips: string[];
}

export const EXERCISE_SETUP_DATA: Record<string, ExerciseSetupData> = {
  'Barbell Curl': {
    keySetup: 'Face the camera directly',
    reasonText: 'Tracks both arms for bilateral curl symmetry and elbow drift.',
    cameraTips: [
      'Place the phone about 6–8 feet in front of you at chest height.',
      'Stand centered in frame with your full body and the barbell visible.',
      'Leave a bit of headroom so the bar never leaves the screen at the top.',
    ],
  },
  'Barbell Squat': {
    keySetup: 'Camera perpendicular to your body',
    reasonText: 'Tracks knee depth, hip hinge angle, and torso forward lean from the side.',
    cameraTips: [
      'Set the phone roughly at hip height, perpendicular to your body.',
      'Stand 6–8 feet away so your whole body and the barbell are in frame.',
      'Aim the camera so you can see your feet, hips, and head throughout the squat.',
    ],
  },
  'Push-Up': {
    keySetup: 'Camera perpendicular to your body',
    reasonText: 'Tracks shoulder-hip-ankle alignment and elbow angle from the side.',
    cameraTips: [
      'Place the phone 4–6 feet away at about knee height on your side.',
      'Frame from head to feet so your whole plank line is visible.',
      'Angle slightly toward your shoulders so elbows and hips stay clear in view.',
    ],
  },
  'Cable Pushdowns': {
    keySetup: 'Camera perpendicular to your body',
    reasonText: 'Tracks elbow extension angle and upper arm drift from the side.',
    cameraTips: [
      'Place the phone slightly in front and to the side at mid‑torso height.',
      'Frame from your head down to just below the weight stack or your hips.',
      'Avoid blocking the view with the cable column — angle a bit forward if needed.',
    ],
  },
  'Cable Row': {
    keySetup: 'Camera perpendicular to your body',
    reasonText: 'Tracks elbow pull angle and shoulder retraction from the side.',
    cameraTips: [
      'Set the phone to the side at about chest height while you sit.',
      'Frame from your head to just past the handle so elbows stay visible.',
      'Keep the bench and stack in view without cutting off your shoulders.',
    ],
  },
  'Standing Dumbbell Lateral Raises': {
    keySetup: 'Face the camera directly',
    reasonText: 'Tracks bilateral arm abduction and shrug detection from the front.',
    cameraTips: [
      'Place the phone 6–8 feet directly in front of you at chest height.',
      'Stand centered so both arms have equal space to move out to the sides.',
      'Leave room above your head so dumbbells never cut off at the top.',
    ],
  },
  'Cable Lat Pulldowns': {
    keySetup: 'Camera to your side or at a diagonal',
    reasonText: 'Tracks elbow angle and torso lean from the side or diagonal — one arm is enough.',
    cameraTips: [
      'Place the phone to your side at about chest height, facing the machine.',
      'A 45° diagonal also works — just make sure one arm and your torso are clearly visible.',
      'Frame from your head to your hips so the full range of the bar path is visible.',
    ],
  },
  'Leg Extensions': {
    keySetup: 'Camera perpendicular while seated',
    reasonText: 'Tracks knee extension angle and detects hip lift from the side.',
    cameraTips: [
      'Place the phone to your side at knee height, facing the machine.',
      'Frame from your hips down to your feet so the pad and ankles are visible.',
      'Angle slightly forward so any hip lift off the pad is easy to see.',
    ],
  },
  'Lying Leg Curl': {
    keySetup: 'Camera perpendicular while prone',
    reasonText: 'Tracks knee flexion angle and detects hip lift from the side.',
    cameraTips: [
      'Set the phone at knee height on your side, perpendicular to the bench.',
      'Frame from your hips down to your feet so the roller and ankles stay visible.',
      'Make sure your hips and low back are in frame to catch any lifting off the pad.',
    ],
  },
  'Machine Ab Crunches': {
    keySetup: 'Camera perpendicular while seated',
    reasonText: 'Tracks torso flexion angle and neck position from the side.',
    cameraTips: [
      'Place the phone to the side at roughly chest height while you sit.',
      'Frame from the top of your head to your hips so the crunch arc is clear.',
      'Angle slightly toward your chest so neck and upper‑back position stay visible.',
    ],
  },
};

export interface ExercisePerformData {
  /** Step-by-step form cues for performing the exercise */
  steps: string[];
  /** Common mistakes to avoid */
  commonMistakes: string[];
}

export const EXERCISE_PERFORM_DATA: Record<string, ExercisePerformData> = {
  'Barbell Curl': {
    steps: [
      'Stand with feet shoulder-width apart, grip the barbell at shoulder width.',
      'Keep elbows pinned to your sides throughout the movement.',
      'Curl the bar up by contracting your biceps — squeeze at the top.',
      'Lower the bar slowly and fully extend your arms at the bottom.',
      'Maintain an upright torso — avoid swinging or leaning back.',
    ],
    commonMistakes: [
      'Not curling high enough — contract the bicep fully at the top.',
      'Not extending fully at the bottom — get a full stretch.',
      'Swinging the torso to generate momentum.',
      'Letting elbows drift forward or flare out to the sides.',
      'Moving too fast — control both the up and down phases.',
    ],
  },
  'Barbell Squat': {
    steps: [
      'Position the bar on your upper traps, feet shoulder-width apart.',
      'Brace your core and initiate by pushing hips back.',
      'Bend knees and descend until thighs are at least parallel.',
      'Drive through your heels to stand back up fully.',
      'Keep your chest up and maintain a neutral spine throughout.',
    ],
    commonMistakes: [
      'Not reaching parallel depth on each rep.',
      'Excessive forward lean of the torso.',
      'Knees caving inward during the ascent.',
      'Rising onto toes instead of driving through heels.',
      'Not locking out fully at the top.',
    ],
  },
  'Push-Up': {
    steps: [
      'Start in a plank position with hands slightly wider than shoulders.',
      'Keep your body in a straight line from head to heels.',
      'Lower your chest toward the floor until elbows reach 90 degrees.',
      'Push back up to full arm extension — lock out at the top.',
      'Engage your core throughout to prevent hip sag or pike.',
    ],
    commonMistakes: [
      'Not going deep enough — aim for elbows at 90 degrees.',
      'Hips sagging toward the floor — brace your core.',
      'Hips piking up — keep a straight body line.',
      'Not locking out fully at the top of each rep.',
      'Rushing through reps — control both phases.',
    ],
  },
  'Cable Pushdowns': {
    steps: [
      'Stand facing the cable machine, grip the bar or rope at chest height.',
      'Pin your elbows to your sides and keep upper arms stationary.',
      'Push the weight down by extending your elbows fully.',
      'Slowly return to the starting position with control.',
      'Avoid leaning forward or using body momentum.',
    ],
    commonMistakes: [
      'Upper arms drifting forward — keep elbows locked at your sides.',
      'Not extending fully at the bottom — lock out each rep.',
      'Leaning over the weight instead of standing upright.',
      'Using too much weight and compensating with body swing.',
    ],
  },
  'Cable Row': {
    steps: [
      'Sit with feet on the platform, knees slightly bent.',
      'Grip the handle and sit tall with a neutral spine.',
      'Pull the handle toward your lower chest, squeezing shoulder blades.',
      'Extend arms back to the start with control — feel the stretch.',
      'Keep your torso upright — avoid rocking back and forth.',
    ],
    commonMistakes: [
      'Not pulling far enough — squeeze your shoulder blades together.',
      'Rocking the torso excessively to generate momentum.',
      'Rounding the lower back during the stretch phase.',
      'Shrugging shoulders up instead of pulling back.',
    ],
  },
  'Standing Dumbbell Lateral Raises': {
    steps: [
      'Stand with feet shoulder-width apart, dumbbells at your sides.',
      'With a slight bend in your elbows, raise arms out to the sides.',
      'Lift until your arms are at shoulder level — no higher.',
      'Lower the weights slowly back to your sides.',
      'Keep your traps relaxed — don\'t shrug your shoulders up.',
    ],
    commonMistakes: [
      'Not raising high enough — aim for shoulder level.',
      'Shrugging shoulders up, shifting work to the traps.',
      'Using momentum by swinging the weights.',
      'Raising arms unevenly — keep both sides symmetrical.',
      'Lowering too fast — control the eccentric phase.',
    ],
  },
  'Cable Lat Pulldowns': {
    steps: [
      'Sit with thighs secured under the pads, grip the bar wide.',
      'Lean back slightly and pull the bar to your upper chest.',
      'Squeeze your lats at the bottom of the movement.',
      'Let the bar return overhead with control — full stretch at the top.',
      'Keep your chest up and avoid excessive torso lean.',
    ],
    commonMistakes: [
      'Not pulling deep enough — bring the bar to your upper chest.',
      'Leaning too far back and turning it into a row.',
      'Not fully extending arms at the top — get the full stretch.',
      'Pulling with the arms instead of initiating with the lats.',
    ],
  },
  'Leg Extensions': {
    steps: [
      'Sit with your back flat against the pad, ankles behind the roller.',
      'Grip the handles and extend your legs fully at the knee.',
      'Squeeze your quads hard at the top — hold briefly.',
      'Lower the weight slowly back to the start position.',
      'Keep your hips pressed into the seat throughout.',
    ],
    commonMistakes: [
      'Not extending fully — straighten your legs completely at the top.',
      'Lifting hips off the seat to generate momentum.',
      'Lowering too fast — control the eccentric phase.',
      'Using too much weight and sacrificing range of motion.',
    ],
  },
  'Lying Leg Curl': {
    steps: [
      'Lie face-down with the roller pad behind your ankles.',
      'Grip the handles and curl your heels toward your glutes.',
      'Squeeze your hamstrings at the top of the movement.',
      'Lower the weight slowly back to full extension.',
      'Keep your hips pressed into the pad — don\'t let them rise.',
    ],
    commonMistakes: [
      'Not curling high enough — bring heels close to your glutes.',
      'Lifting hips off the pad during the curl.',
      'Dropping the weight quickly on the way down.',
      'Not extending fully at the bottom — get the full stretch.',
    ],
  },
  'Machine Ab Crunches': {
    steps: [
      'Sit with your chest against the pad, feet flat on the floor.',
      'Grip the handles and crunch forward by contracting your abs.',
      'Bring your chest toward your knees with control.',
      'Slowly return to the upright position — resist the weight.',
      'Focus on curling your spine, not just hinging at the hips.',
    ],
    commonMistakes: [
      'Not crunching deep enough — bring your chest closer to your knees.',
      'Using arms to pull instead of contracting the abs.',
      'Jerking your neck forward — keep your neck neutral.',
      'Returning too fast — control the eccentric phase.',
    ],
  },
};
