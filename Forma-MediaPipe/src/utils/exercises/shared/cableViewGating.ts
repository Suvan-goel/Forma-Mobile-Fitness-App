import type { RepReliabilityInterpretation } from './reliabilityInterpretation';
import type { RepDiagnostics, RepViewCueGatingDiagnostic } from '../types';

export type CableCueViewRequirement =
  | 'anyView'
  | 'selectedSideOk'
  | 'sidePreferred'
  | 'sideRequired'
  | 'bilateralGeometryRequired';

type CableSide = 'left' | 'right';

export interface CableViewCueDecision {
  finalSafeCueFamilies: string[];
  finalUnsafeCueFamilies: string[];
  viewBlockedCueFamilies: string[];
  poseStateBlockedCueFamilies: string[];
  finalAllowedCueFamilies: ReadonlySet<string>;
  sideViewGatePassed: boolean;
  partialViewScoringAllowed: boolean;
  scorable: boolean;
  finalScorableReason?: string;
  finalUnscorableReason?: string;
}

export function selectedArmChain(side: CableSide): 'leftArm' | 'rightArm' {
  return side === 'left' ? 'leftArm' : 'rightArm';
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values));
}

function sortedUnique(values: Iterable<string>): string[] {
  return uniqueStrings(values).sort((a, b) => a.localeCompare(b));
}

function hasSelectedArmAndTorsoReliability(
  interpretation: RepReliabilityInterpretation | null,
  selectedSide: CableSide,
): boolean {
  if (!interpretation) return false;
  return (
    interpretation.usableChains.includes(selectedArmChain(selectedSide)) &&
    interpretation.usableChains.includes('torso') &&
    interpretation.scoreabilityCandidate !== 'notScoreable'
  );
}

function cueFamilyAllowedByView(
  requirement: CableCueViewRequirement,
  sideViewGatePassed: boolean,
  selectedArmAndTorsoUsable: boolean,
): boolean {
  if (sideViewGatePassed) return true;
  switch (requirement) {
    case 'anyView':
      return true;
    case 'selectedSideOk':
    case 'sidePreferred':
      return selectedArmAndTorsoUsable;
    case 'sideRequired':
    case 'bilateralGeometryRequired':
      return false;
    default:
      return false;
  }
}

export function resolveCableViewCueDecision(args: {
  allCueFamilies: readonly string[];
  meaningfulCueFamilies: readonly string[];
  cueViewRequirements: Record<string, CableCueViewRequirement>;
  sideViewGatePassed: boolean;
  interpretation: RepReliabilityInterpretation | null;
  selectedSide: CableSide;
}): CableViewCueDecision {
  const {
    allCueFamilies,
    meaningfulCueFamilies,
    cueViewRequirements,
    sideViewGatePassed,
    interpretation,
    selectedSide,
  } = args;
  const selectedArmAndTorsoUsable = hasSelectedArmAndTorsoReliability(interpretation, selectedSide);
  const reliabilitySafeFamilies = new Set(interpretation?.safeCueFamilies ?? allCueFamilies);
  const poseStateBlockedCueFamilies = sortedUnique(interpretation?.unsafeCueFamilies ?? []);
  const poseStateBlockedSet = new Set(poseStateBlockedCueFamilies);
  const viewBlockedCueFamilies: string[] = [];
  const finalSafeCueFamilies: string[] = [];
  const finalUnsafeCueFamilies: string[] = [];

  for (const family of allCueFamilies) {
    const requirement = cueViewRequirements[family] ?? 'sideRequired';
    const viewAllows = cueFamilyAllowedByView(requirement, sideViewGatePassed, selectedArmAndTorsoUsable);
    const poseStateAllows = reliabilitySafeFamilies.has(family) && !poseStateBlockedSet.has(family);
    if (!viewAllows) viewBlockedCueFamilies.push(family);
    if (viewAllows && poseStateAllows) finalSafeCueFamilies.push(family);
    else finalUnsafeCueFamilies.push(family);
  }

  const finalSafeSet = new Set(finalSafeCueFamilies);
  const hasMeaningfulSafeCue = meaningfulCueFamilies.some((family) => finalSafeSet.has(family));
  const reliabilityAllowsScoring =
    !interpretation ||
    (
      interpretation.scoreabilityCandidate !== 'notScoreable' &&
      selectedArmAndTorsoUsable
    );
  const partialViewScoringAllowed = !sideViewGatePassed && selectedArmAndTorsoUsable && hasMeaningfulSafeCue;
  const scorable = reliabilityAllowsScoring && (sideViewGatePassed || partialViewScoringAllowed);

  let finalScorableReason: string | undefined;
  let finalUnscorableReason: string | undefined;
  if (scorable) {
    finalScorableReason = sideViewGatePassed ? 'side_view_confirmed' : 'partial_view_scoring';
  } else if (!reliabilityAllowsScoring) {
    finalUnscorableReason = 'pose_reliability_not_scoreable';
  } else if (!sideViewGatePassed && !interpretation) {
    finalUnscorableReason = 'side_view_uncertain';
  } else if (!sideViewGatePassed && !selectedArmAndTorsoUsable) {
    finalUnscorableReason = 'side_view_failed_selected_arm_or_torso_unreliable';
  } else if (!hasMeaningfulSafeCue) {
    finalUnscorableReason = 'no_meaningful_safe_cue_families';
  } else {
    finalUnscorableReason = 'side_view_uncertain';
  }

  return {
    finalSafeCueFamilies: sortedUnique(finalSafeCueFamilies),
    finalUnsafeCueFamilies: sortedUnique(finalUnsafeCueFamilies),
    viewBlockedCueFamilies: sortedUnique(viewBlockedCueFamilies),
    poseStateBlockedCueFamilies,
    finalAllowedCueFamilies: new Set(finalSafeCueFamilies),
    sideViewGatePassed,
    partialViewScoringAllowed,
    scorable,
    finalScorableReason,
    finalUnscorableReason,
  };
}

export function cableViewCueGatingDiagnostic(decision: CableViewCueDecision): RepViewCueGatingDiagnostic {
  return {
    viewBlockedCueFamilies: decision.viewBlockedCueFamilies,
    poseStateBlockedCueFamilies: decision.poseStateBlockedCueFamilies,
    finalSafeCueFamilies: decision.finalSafeCueFamilies,
    finalUnsafeCueFamilies: decision.finalUnsafeCueFamilies,
    finalScorableReason: decision.finalScorableReason,
    finalUnscorableReason: decision.finalUnscorableReason,
    sideViewGatePassed: decision.sideViewGatePassed,
    partialViewScoringAllowed: decision.partialViewScoringAllowed,
  };
}

export function applyCableCueGatingToDiagnostics(args: {
  diagnostics: RepDiagnostics;
  decision: CableViewCueDecision;
  issueCueFamilies: Record<string, string | string[]>;
}): RepDiagnostics {
  const { diagnostics, decision, issueCueFamilies } = args;
  const viewBlocked = new Set(decision.viewBlockedCueFamilies);
  const poseStateBlocked = new Set(decision.poseStateBlockedCueFamilies);
  const suppressedIssueIds: string[] = [];
  const suppressedCueFamilies = new Set<string>();
  const cues = Object.fromEntries(
    Object.entries(diagnostics.cues).map(([issueId, cue]) => {
      const familiesValue = issueCueFamilies[issueId] ?? [];
      const families = Array.isArray(familiesValue) ? familiesValue : [familiesValue];
      const viewBlockedFamily = families.find((family) => viewBlocked.has(family));
      const poseStateBlockedFamily = families.find((family) => poseStateBlocked.has(family));
      const blockedFamily = viewBlockedFamily ?? poseStateBlockedFamily;
      if (!blockedFamily) return [issueId, cue];

      suppressedIssueIds.push(issueId);
      for (const family of families) {
        if (viewBlocked.has(family) || poseStateBlocked.has(family)) suppressedCueFamilies.add(family);
      }

      return [issueId, {
        ...cue,
        eligible: false,
        triggered: false,
        skippedReason: viewBlockedFamily
          ? `view_unsafe_${viewBlockedFamily}`
          : `reliability_unsafe_${poseStateBlockedFamily}`,
      }];
    }),
  );

  return {
    ...diagnostics,
    scorable: decision.scorable,
    cues,
    viewCueGating: cableViewCueGatingDiagnostic(decision),
    reliability: diagnostics.reliability
      ? {
          ...diagnostics.reliability,
          suppressedCueFamilies: sortedUnique([
            ...(diagnostics.reliability.suppressedCueFamilies ?? []),
            ...suppressedCueFamilies,
          ]),
          suppressedIssueIds: sortedUnique([
            ...(diagnostics.reliability.suppressedIssueIds ?? []),
            ...suppressedIssueIds,
          ]),
        }
      : diagnostics.reliability,
  };
}
