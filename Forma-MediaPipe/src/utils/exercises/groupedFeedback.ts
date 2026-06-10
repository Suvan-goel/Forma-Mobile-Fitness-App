export type GroupedFeedbackGroupId = string;

export type GroupedFeedbackRuntimeMode =
  | 'taxonomy-only'
  | 'runtime-active'
  | 'shadow-only'
  | 'heuristic-only';

export type GroupedFeedbackRecommendedSurface =
  | 'rep-level'
  | 'set-level'
  | 'shadow-only'
  | 'hidden';

export interface GroupedFeedbackReadiness {
  readyForRuntime: boolean;
  requiresDataset: boolean;
  currentStatus: GroupedFeedbackRuntimeMode;
  recommendedSurface: GroupedFeedbackRecommendedSurface;
  runtimeFeatureFlag?: string;
  fallbackFeatureFlag?: string;
}

export interface GroupedFeedbackDefinition {
  exerciseId: string;
  exerciseName: string;
  id: GroupedFeedbackGroupId;
  key: string;
  message: string;
  description: string;
  requiredView?: 'front' | 'side' | 'any';
  requiredCueFamilies?: readonly string[];
  repLevelCandidate: boolean;
  setLevelCandidate: boolean;
  mlReady: boolean;
  heuristicOnly: boolean;
  hiddenInternal: boolean;
  readiness: GroupedFeedbackReadiness;
  fineIssueIds?: readonly string[];
  notes?: readonly string[];
  todos?: readonly string[];
}

export interface ExerciseGroupedFeedbackDefinition {
  exerciseId: string;
  exerciseName: string;
  groups: readonly GroupedFeedbackDefinition[];
  notes?: readonly string[];
  unmappedFineIssueIds?: readonly {
    issueId: string;
    note: string;
  }[];
}

type GroupInput = Omit<GroupedFeedbackDefinition, 'exerciseId' | 'exerciseName' | 'id'>;

function group(
  exerciseId: string,
  exerciseName: string,
  input: GroupInput,
): GroupedFeedbackDefinition {
  return {
    exerciseId,
    exerciseName,
    id: `${exerciseId}.${input.key}`,
    ...input,
  };
}

function exercise(
  exerciseId: string,
  exerciseName: string,
  groups: readonly GroupInput[],
  extra: Pick<ExerciseGroupedFeedbackDefinition, 'notes' | 'unmappedFineIssueIds'> = {},
): ExerciseGroupedFeedbackDefinition {
  return {
    exerciseId,
    exerciseName,
    groups: groups.map((entry) => group(exerciseId, exerciseName, entry)),
    ...extra,
  };
}

const BARBELL_CURL_GROUPED_FLAG = 'EXPO_PUBLIC_ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK';
const BARBELL_CURL_FALLBACK_FLAG = 'EXPO_PUBLIC_ENABLE_BARBELL_CURL_ML_GROUPED_FALLBACK_FEEDBACK';

const runtimeActiveBarbellCurl: GroupedFeedbackReadiness = {
  readyForRuntime: true,
  requiresDataset: false,
  currentStatus: 'runtime-active',
  recommendedSurface: 'rep-level',
  runtimeFeatureFlag: BARBELL_CURL_GROUPED_FLAG,
  fallbackFeatureFlag: BARBELL_CURL_FALLBACK_FLAG,
};

const taxonomyOnlyRepLevel: GroupedFeedbackReadiness = {
  readyForRuntime: false,
  requiresDataset: true,
  currentStatus: 'taxonomy-only',
  recommendedSurface: 'rep-level',
};

const taxonomyOnlyHidden: GroupedFeedbackReadiness = {
  readyForRuntime: false,
  requiresDataset: true,
  currentStatus: 'taxonomy-only',
  recommendedSurface: 'hidden',
};

export const GROUPED_FEEDBACK_TAXONOMY: readonly ExerciseGroupedFeedbackDefinition[] = [
  exercise(
    'barbell-curl',
    'Barbell Curl',
    [
      {
        key: 'ROM_issue',
        message: 'Use a fuller range of motion.',
        description: 'Groups incomplete top flexion, incomplete bottom extension, and short total curl range.',
        requiredView: 'front',
        requiredCueFamilies: ['visibleArmRom', 'bilateralArmRom'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: true,
        heuristicOnly: false,
        hiddenInternal: false,
        readiness: runtimeActiveBarbellCurl,
        fineIssueIds: [
          'barbell-curl.incomplete_flex',
          'barbell-curl.incomplete_extend',
          'barbell-curl.incomplete_rom',
        ],
        notes: ['Runtime grouped ML is opt-in; repeated ROM fallback remains shadow-only unless fallback is explicitly enabled.'],
      },
      {
        key: 'shoulder_issue',
        message: 'Avoid using your shoulders to lift the bar.',
        description: 'Groups shoulder takeover warning/failure signals.',
        requiredView: 'front',
        requiredCueFamilies: ['visibleArmRom'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: true,
        heuristicOnly: false,
        hiddenInternal: false,
        readiness: runtimeActiveBarbellCurl,
        fineIssueIds: ['barbell-curl.shoulder_warn', 'barbell-curl.shoulder_fail'],
      },
      {
        key: 'torso_issue',
        message: 'Keep your torso still.',
        description: 'Groups torso swing warning/failure signals.',
        requiredView: 'front',
        requiredCueFamilies: ['torsoControl'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: true,
        heuristicOnly: false,
        hiddenInternal: false,
        readiness: runtimeActiveBarbellCurl,
        fineIssueIds: ['barbell-curl.torso_warn', 'barbell-curl.torso_fail'],
        notes: ['Runtime grouped ML is opt-in; repeated torso fallback remains shadow-only unless fallback is explicitly enabled.'],
      },
      {
        key: 'tempo_issue',
        message: 'Control the speed of the rep.',
        description: 'Groups fast curl and fast lowering tempo issues.',
        requiredView: 'front',
        requiredCueFamilies: ['tempo'],
        repLevelCandidate: true,
        setLevelCandidate: true,
        mlReady: true,
        heuristicOnly: false,
        hiddenInternal: false,
        readiness: runtimeActiveBarbellCurl,
        fineIssueIds: ['barbell-curl.tempo_up', 'barbell-curl.tempo_down'],
      },
    ],
    {
      notes: ['Barbell Curl is the only exercise with runtime grouped ML feedback today.'],
      unmappedFineIssueIds: [
        { issueId: 'barbell-curl.asymmetry', note: 'Keep internal until grouped symmetry taxonomy is validated.' },
        { issueId: 'barbell-curl.elbow_flare', note: 'Keep internal until elbow-path grouping is validated.' },
      ],
    },
  ),
  exercise('standing-dumbbell-lateral-raises', 'Standing Dumbbell Lateral Raises', [
    {
      key: 'ROM_height_issue',
      message: 'Raise the dumbbells to the right height.',
      description: 'Groups under-raising and over-raising height issues.',
      requiredView: 'front',
      requiredCueFamilies: ['visibleArmRaise'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: [
        'standing-dumbbell-lateral-raises.rom_height',
        'standing-dumbbell-lateral-raises.over_raise',
      ],
    },
    {
      key: 'torso_shrug_issue',
      message: 'Keep your torso steady and avoid shrugging.',
      description: 'Groups torso lean and shoulder shrug compensation.',
      requiredView: 'front',
      requiredCueFamilies: ['torsoControl'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: [
        'standing-dumbbell-lateral-raises.torso_warn',
        'standing-dumbbell-lateral-raises.shoulder_shrug',
      ],
    },
    {
      key: 'path_plane_issue',
      message: 'Keep the raise path controlled.',
      description: 'Groups wrong-plane and excessive elbow-bend path issues.',
      requiredView: 'front',
      requiredCueFamilies: ['shoulderElbowWristPath'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: [
        'standing-dumbbell-lateral-raises.wrong_plane',
        'standing-dumbbell-lateral-raises.elbow_bend',
      ],
    },
    {
      key: 'symmetry_issue',
      message: 'Raise both sides evenly.',
      description: 'Groups bilateral height asymmetry.',
      requiredView: 'front',
      requiredCueFamilies: ['bilateralRaiseSymmetry'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['standing-dumbbell-lateral-raises.asymmetry'],
    },
    {
      key: 'tempo_issue',
      message: 'Control the speed of the rep.',
      description: 'Groups fast raise and fast lowering issues.',
      requiredView: 'front',
      requiredCueFamilies: ['visibleArmRaise'],
      repLevelCandidate: true,
      setLevelCandidate: true,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: [
        'standing-dumbbell-lateral-raises.tempo_up',
        'standing-dumbbell-lateral-raises.tempo_down',
      ],
    },
  ]),
  exercise('cable-row', 'Cable Row', [
    {
      key: 'range_path_issue',
      message: 'Use a full, controlled pull.',
      description: 'Groups pull depth, return extension, and high-row path issues.',
      requiredView: 'side',
      requiredCueFamilies: ['visibleArmPath', 'handlePath'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['cable-row.row_depth', 'cable-row.row_extension', 'cable-row.high_row'],
    },
    {
      key: 'torso_control_issue',
      message: 'Keep your torso steady.',
      description: 'Groups leaning back and rocking through the row.',
      requiredView: 'side',
      requiredCueFamilies: ['torsoControl'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['cable-row.torso_warn', 'cable-row.torso_rocking'],
    },
    {
      key: 'shoulder_scapular_issue',
      message: 'Control your shoulders through the pull.',
      description: 'Groups weak shoulder retraction and shoulder shrug compensation.',
      requiredView: 'side',
      requiredCueFamilies: ['visibleArmPath', 'torsoControl'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['cable-row.shoulder_retraction', 'cable-row.shoulder_shrug'],
    },
    {
      key: 'tempo_issue',
      message: 'Control the speed of the rep.',
      description: 'Groups fast pull and uncontrolled return.',
      requiredView: 'side',
      requiredCueFamilies: ['tempo'],
      repLevelCandidate: true,
      setLevelCandidate: true,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['cable-row.tempo_down', 'cable-row.tempo_up'],
    },
  ]),
  exercise('cable-pushdowns', 'Cable Pushdowns', [
    {
      key: 'elbow_position_issue',
      message: 'Keep your elbows fixed by your sides.',
      description: 'Groups elbow drift and forward elbow setup issues.',
      requiredView: 'side',
      requiredCueFamilies: ['elbowPath'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['cable-pushdowns.elbow_drift', 'cable-pushdowns.elbow_forward'],
    },
    {
      key: 'ROM_lockout_issue',
      message: 'Fully extend and control the movement.',
      description: 'Groups short lockout and short top stretch/range issues.',
      requiredView: 'side',
      requiredCueFamilies: ['handlePath', 'wristSpecific', 'visibleArmPath'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['cable-pushdowns.lockout_short', 'cable-pushdowns.rom_short'],
    },
    {
      key: 'shoulder_torso_compensation_issue',
      message: 'Avoid using your shoulders or torso.',
      description: 'Groups torso lean and torso rocking compensation.',
      requiredView: 'side',
      requiredCueFamilies: ['torsoControl'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['cable-pushdowns.torso_warn', 'cable-pushdowns.torso_rocking'],
    },
    {
      key: 'tempo_issue',
      message: 'Control the speed of the rep.',
      description: 'Groups fast press and uncontrolled return.',
      requiredView: 'side',
      requiredCueFamilies: ['tempo'],
      repLevelCandidate: true,
      setLevelCandidate: true,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['cable-pushdowns.tempo_down', 'cable-pushdowns.tempo_up'],
    },
  ]),
  exercise(
    'cable-lat-pulldowns',
    'Cable Lat Pulldowns',
    [
      {
        key: 'ROM_issue',
        message: 'Use a full, controlled range of motion.',
        description: 'Groups short pull depth and incomplete return extension.',
        requiredView: 'side',
        requiredCueFamilies: ['rangeOfMotion', 'handlePath', 'visibleArmPath'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: ['cable-lat-pulldowns.rom_short', 'cable-lat-pulldowns.lockout_short'],
      },
      {
        key: 'torso_lean_issue',
        message: 'Avoid leaning back too much.',
        description: 'Groups torso lean and torso rocking during the pull.',
        requiredView: 'side',
        requiredCueFamilies: ['torsoControl'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: ['cable-lat-pulldowns.torso_warn', 'cable-lat-pulldowns.torso_rocking'],
      },
      {
        key: 'shoulder_scapular_issue',
        message: 'Control your shoulders through the pull.',
        description: 'Groups elbow drive and shoulder shrug issues.',
        requiredView: 'side',
        requiredCueFamilies: ['elbowPath', 'visibleArmPath', 'torsoControl'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: ['cable-lat-pulldowns.elbow_drive', 'cable-lat-pulldowns.shoulder_shrug'],
      },
      {
        key: 'path_asymmetry_issue',
        message: 'Keep the bar path even and controlled.',
        description: 'Placeholder for future handle path and bilateral asymmetry grouping.',
        requiredView: 'side',
        requiredCueFamilies: ['handlePath'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: true,
        readiness: taxonomyOnlyHidden,
        todos: ['No explicit fine issue exists yet; map after path/asymmetry labels are introduced.'],
      },
      {
        key: 'tempo_issue',
        message: 'Control the speed of the rep.',
        description: 'Groups fast pull and uncontrolled return.',
        requiredView: 'side',
        requiredCueFamilies: ['tempo'],
        repLevelCandidate: true,
        setLevelCandidate: true,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: ['cable-lat-pulldowns.tempo_down', 'cable-lat-pulldowns.tempo_up'],
      },
    ],
  ),
  exercise('leg-extensions', 'Leg Extensions', [
    {
      key: 'ROM_lockout_issue',
      message: 'Fully extend and control the rep.',
      description: 'Groups short lockout and short flexion/range issues.',
      requiredView: 'side',
      requiredCueFamilies: ['distalEndpoint', 'rangeOfMotion', 'lockout', 'kneeExtension', 'visibleLegPath'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['leg-extensions.lockout_short', 'leg-extensions.rom_short_leg_ext'],
    },
    {
      key: 'hip_setup_stability_issue',
      message: 'Keep your hips and setup stable.',
      description: 'Groups torso setup movement and hip lift.',
      requiredView: 'side',
      requiredCueFamilies: ['torsoSetup'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['leg-extensions.torso_warn', 'leg-extensions.hip_lift'],
    },
    {
      key: 'tempo_hold_issue',
      message: 'Control the lift and hold.',
      description: 'Groups fast extension/return and short top hold.',
      requiredView: 'side',
      requiredCueFamilies: ['tempo', 'lockout', 'rangeOfMotion'],
      repLevelCandidate: true,
      setLevelCandidate: true,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['leg-extensions.tempo_up', 'leg-extensions.tempo_down', 'leg-extensions.top_hold_short'],
    },
  ]),
  exercise('lying-leg-curl', 'Lying Leg Curl', [
    {
      key: 'ROM_issue',
      message: 'Use a full, controlled curl.',
      description: 'Groups short curl depth and incomplete return extension.',
      requiredView: 'side',
      requiredCueFamilies: ['visibleLegPath', 'distalEndpoint', 'lockoutOrExtension'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['lying-leg-curl.rom_curl_short', 'lying-leg-curl.rom_extend_short'],
    },
    {
      key: 'hip_thigh_control_issue',
      message: 'Keep your hips and thighs stable.',
      description: 'Groups hip lift and thigh drift.',
      requiredView: 'side',
      requiredCueFamilies: ['visibleLegPath', 'torsoSetup'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['lying-leg-curl.hip_lift', 'lying-leg-curl.thigh_movement'],
    },
    {
      key: 'tempo_hold_issue',
      message: 'Control the curl and return.',
      description: 'Groups fast curl, fast lowering, jerky tempo, and short top hold.',
      requiredView: 'side',
      requiredCueFamilies: ['tempo', 'lockoutOrExtension'],
      repLevelCandidate: true,
      setLevelCandidate: true,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: [
        'lying-leg-curl.tempo_up',
        'lying-leg-curl.tempo_down',
        'lying-leg-curl.tempo_jerk',
        'lying-leg-curl.top_hold_short',
      ],
    },
    {
      key: 'setup_view_issue',
      message: 'Keep the working leg clearly visible.',
      description: 'Groups side-view confidence/setup limitations.',
      requiredView: 'side',
      repLevelCandidate: false,
      setLevelCandidate: true,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: true,
      readiness: taxonomyOnlyHidden,
      fineIssueIds: ['lying-leg-curl.side_view_uncertain'],
    },
  ]),
  exercise(
    'machine-ab-crunches',
    'Machine Ab Crunches',
    [
      {
        key: 'ROM_issue',
        message: 'Use a controlled crunch range.',
        description: 'Groups short crunch depth and incomplete upright return.',
        requiredView: 'side',
        requiredCueFamilies: ['hipAngle', 'shoulderHipAlignment'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: ['machine-ab-crunches.depth_short', 'machine-ab-crunches.lockout_short'],
      },
      {
        key: 'neck_arm_compensation_issue',
        message: 'Avoid pulling with your neck or arms.',
        description: 'Groups neck-forward and arm-pull compensation.',
        requiredView: 'side',
        requiredCueFamilies: ['setupPosture', 'neckPosition', 'auxiliaryArmCue'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: ['machine-ab-crunches.neck_forward', 'machine-ab-crunches.arm_pull'],
      },
      {
        key: 'hip_setup_control_issue',
        message: 'Keep your hips and setup stable.',
        description: 'Groups hips moving during the crunch.',
        requiredView: 'side',
        requiredCueFamilies: ['setupPosture', 'kneeSupport', 'shoulderHipAlignment'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: ['machine-ab-crunches.hips_moving'],
      },
      {
        key: 'tempo_issue',
        message: 'Control the speed of the rep.',
        description: 'Groups fast crunch, fast return, and jerky tempo.',
        requiredView: 'side',
        requiredCueFamilies: ['tempo'],
        repLevelCandidate: true,
        setLevelCandidate: true,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: [
          'machine-ab-crunches.tempo_down',
          'machine-ab-crunches.tempo_up',
          'machine-ab-crunches.tempo_jerk',
        ],
      },
    ],
    {
      unmappedFineIssueIds: [
        { issueId: 'machine-ab-crunches.side_view_uncertain', note: 'Camera setup/status issue; keep out of rep feedback groups for now.' },
      ],
    },
  ),
  exercise('push-up', 'Push-Up', [
    {
      key: 'depth_issue',
      message: 'Reach proper push-up depth.',
      description: 'Groups short depth, incomplete lockout, and short total range.',
      requiredView: 'side',
      requiredCueFamilies: ['armDepth', 'elbowPath', 'wristHandPlacement'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['push-up.depth_short', 'push-up.lockout_short', 'push-up.incomplete_rom'],
    },
    {
      key: 'body_line_issue',
      message: 'Keep your body in a straight line.',
      description: 'Groups hip sag, hip pike, and head/neck alignment.',
      requiredView: 'side',
      requiredCueFamilies: ['bodyLine', 'hipSag', 'footAnklePosition', 'headNeckPosition'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['push-up.hip_sag', 'push-up.hip_pike', 'push-up.head_position'],
    },
    {
      key: 'elbow_hand_path_issue',
      message: 'Keep your arms and hand path controlled.',
      description: 'Groups shoulder/hand setup and arm path control.',
      requiredView: 'side',
      requiredCueFamilies: ['wristHandPlacement', 'elbowPath'],
      repLevelCandidate: true,
      setLevelCandidate: false,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['push-up.shoulder_stack'],
      todos: ['Add elbow path fine issues before expanding this mapping.'],
    },
    {
      key: 'setup_framing_issue',
      message: 'Set up so your full body is visible.',
      description: 'Groups side-view and full-body framing setup issues.',
      requiredView: 'side',
      requiredCueFamilies: ['torsoControl'],
      repLevelCandidate: false,
      setLevelCandidate: true,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: true,
      readiness: taxonomyOnlyHidden,
      fineIssueIds: ['push-up.camera_setup'],
    },
    {
      key: 'tempo_issue',
      message: 'Control the speed of the rep.',
      description: 'Groups fast press and fast descent.',
      requiredView: 'side',
      requiredCueFamilies: ['tempo'],
      repLevelCandidate: true,
      setLevelCandidate: true,
      mlReady: false,
      heuristicOnly: true,
      hiddenInternal: false,
      readiness: taxonomyOnlyRepLevel,
      fineIssueIds: ['push-up.tempo_up', 'push-up.tempo_down'],
    },
  ]),
  exercise(
    'barbell-squat',
    'Barbell Squat',
    [
      {
        key: 'depth_issue',
        message: 'Reach proper squat depth.',
        description: 'Groups short depth, incomplete lockout, and short total range.',
        requiredView: 'any',
        requiredCueFamilies: ['depth', 'hipKneePath', 'visibleLegPath'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: [
          'barbell-squat.depth_short',
          'barbell-squat.lockout_short',
          'barbell-squat.incomplete_rom',
        ],
      },
      {
        key: 'torso_lean_issue',
        message: 'Keep your torso controlled.',
        description: 'Groups torso lean warning/failure signals.',
        requiredView: 'any',
        requiredCueFamilies: ['torsoLean', 'barPathOrUpperBody'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: ['barbell-squat.torso_warn', 'barbell-squat.torso_fail'],
      },
      {
        key: 'knee_tracking_issue',
        message: 'Keep your knees tracking well.',
        description: 'Placeholder for future knee-tracking grouped feedback.',
        requiredView: 'any',
        requiredCueFamilies: ['kneeTracking'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: true,
        readiness: taxonomyOnlyHidden,
        todos: ['No stable fine issue ID is exposed yet; map after knee-tracking diagnostics are promoted.'],
      },
      {
        key: 'heel_stance_issue',
        message: 'Keep your feet stable.',
        description: 'Groups heel lift and foot-pressure stability.',
        requiredView: 'any',
        requiredCueFamilies: ['ankleFootPosition', 'heelLift'],
        repLevelCandidate: true,
        setLevelCandidate: false,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: ['barbell-squat.heel_lift'],
      },
      {
        key: 'tempo_issue',
        message: 'Control the speed of the rep.',
        description: 'Groups fast ascent and fast descent.',
        requiredView: 'any',
        requiredCueFamilies: ['tempo'],
        repLevelCandidate: true,
        setLevelCandidate: true,
        mlReady: false,
        heuristicOnly: true,
        hiddenInternal: false,
        readiness: taxonomyOnlyRepLevel,
        fineIssueIds: ['barbell-squat.tempo_up', 'barbell-squat.tempo_down'],
      },
    ],
  ),
];

export function getGroupedFeedbackDefinitionForExercise(
  exerciseIdOrName: string,
): ExerciseGroupedFeedbackDefinition | undefined {
  return GROUPED_FEEDBACK_TAXONOMY.find(
    (entry) => entry.exerciseId === exerciseIdOrName || entry.exerciseName === exerciseIdOrName,
  );
}

export function getGroupedFeedbackGroupForFineIssueId(
  exerciseIdOrName: string,
  fineIssueId: string,
): GroupedFeedbackDefinition | undefined {
  return getGroupedFeedbackDefinitionForExercise(exerciseIdOrName)
    ?.groups.find((groupDefinition) => groupDefinition.fineIssueIds?.includes(fineIssueId));
}

