import '../definitions/register';
import { ExerciseRegistry } from '../ExerciseRegistry';
import {
  GROUPED_FEEDBACK_TAXONOMY,
  getGroupedFeedbackDefinitionForExercise,
  getGroupedFeedbackGroupForFineIssueId,
} from '../groupedFeedback';
import { BARBELL_CURL_GROUPED_FEEDBACK_POLICY } from '../ml/runtime/barbellCurlGroupedFeedback';

describe('grouped feedback taxonomy', () => {
  it('covers every registered exercise exactly once', () => {
    const registered = ExerciseRegistry.list().sort();
    const taxonomyNames = GROUPED_FEEDBACK_TAXONOMY.map((entry) => entry.exerciseName).sort();

    expect(taxonomyNames).toEqual(registered);
    expect(new Set(GROUPED_FEEDBACK_TAXONOMY.map((entry) => entry.exerciseId)).size)
      .toBe(GROUPED_FEEDBACK_TAXONOMY.length);
  });

  it('defines stable non-empty groups with unique ids per exercise', () => {
    for (const exerciseDefinition of GROUPED_FEEDBACK_TAXONOMY) {
      expect(exerciseDefinition.exerciseId).toMatch(/^[a-z0-9-]+$/);
      expect(exerciseDefinition.exerciseName.trim()).not.toBe('');
      expect(exerciseDefinition.groups.length).toBeGreaterThan(0);

      const groupIds = new Set<string>();
      for (const group of exerciseDefinition.groups) {
        expect(group.exerciseId).toBe(exerciseDefinition.exerciseId);
        expect(group.exerciseName).toBe(exerciseDefinition.exerciseName);
        expect(group.id).toBe(`${exerciseDefinition.exerciseId}.${group.key}`);
        expect(groupIds.has(group.id)).toBe(false);
        groupIds.add(group.id);
        expect(group.key.trim()).not.toBe('');
        expect(group.message.trim()).not.toBe('');
        expect(group.description.trim()).not.toBe('');
        expect(group.readiness.readyForRuntime).toEqual(expect.any(Boolean));
        expect(group.readiness.requiresDataset).toEqual(expect.any(Boolean));
        expect(['taxonomy-only', 'runtime-active', 'shadow-only', 'heuristic-only'])
          .toContain(group.readiness.currentStatus);
        expect(['rep-level', 'set-level', 'shadow-only', 'hidden'])
          .toContain(group.readiness.recommendedSurface);
      }
    }
  });

  it('maps optional fine issue ids to valid grouped ids', () => {
    for (const exerciseDefinition of GROUPED_FEEDBACK_TAXONOMY) {
      const groupIds = new Set(exerciseDefinition.groups.map((group) => group.id));
      for (const group of exerciseDefinition.groups) {
        expect(groupIds.has(group.id)).toBe(true);
        for (const fineIssueId of group.fineIssueIds ?? []) {
          expect(fineIssueId.startsWith(`${exerciseDefinition.exerciseId}.`)).toBe(true);
          expect(getGroupedFeedbackGroupForFineIssueId(exerciseDefinition.exerciseId, fineIssueId)?.id)
            .toBe(group.id);
        }
      }
    }
  });

  it('keeps Barbell Curl taxonomy messages aligned with the existing runtime policy', () => {
    const barbellCurlTaxonomy = getGroupedFeedbackDefinitionForExercise('Barbell Curl');
    expect(barbellCurlTaxonomy).toBeDefined();

    for (const runtimeGroup of BARBELL_CURL_GROUPED_FEEDBACK_POLICY.groups) {
      const taxonomyGroup = barbellCurlTaxonomy?.groups.find((group) => group.id === runtimeGroup.id);
      expect(taxonomyGroup).toBeDefined();
      expect(taxonomyGroup?.message).toBe(runtimeGroup.message);
      expect(taxonomyGroup?.readiness.currentStatus).toBe('runtime-active');
      expect(taxonomyGroup?.readiness.runtimeFeatureFlag).toBe('EXPO_PUBLIC_ENABLE_BARBELL_CURL_ML_GROUPED_FEEDBACK');
    }
  });

  it('does not attach grouped ML diagnostics to non-Barbell exercises', () => {
    for (const exerciseName of ExerciseRegistry.list()) {
      if (exerciseName === 'Barbell Curl') continue;
      const definition = ExerciseRegistry.get(exerciseName);
      expect(definition).toBeDefined();
      if (!definition) continue;

      const initialState = definition.createState();
      const updatedState = definition.update([], initialState, {
        primarySource: 'image',
        cameraAnalysisStatusRequested: true,
      });

      expect(updatedState.repCount).toBe(0);
      expect(updatedState.lastRepResult).toBeNull();
      expect(updatedState.feedback).toBeNull();
      expect(updatedState.lastRepResult?.diagnostics?.mlGroupedFeedback).toBeUndefined();
    }
  });
});

