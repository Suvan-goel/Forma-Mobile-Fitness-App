import fs from 'fs';
import path from 'path';
import ts from 'typescript';

import '../../../utils/exercises/definitions/register';
import {
  FEEDBACK_TO_ISSUE,
  FEEDBACK_TTS_POOLS,
  ISSUE_POOLS,
  getTopFeedbackIssueCandidate,
  normalizeFeedbackMessages,
} from '../ttsMessagePools';

const LOW_ROM_FEEDBACK = 'Use more range for this rep to count.';

function textOfName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function collectObjectKeys(objectLiteral: ts.ObjectLiteralExpression): string[] {
  const keys: string[] = [];
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = textOfName(property.name);
    if (key) keys.push(key);
  }
  return keys;
}

function findProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string
): ts.PropertyAssignment | undefined {
  return objectLiteral.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && textOfName(property.name) === propertyName
  );
}

function collectExerciseFeedbackLiterals(): {
  visualFeedback: Set<string>;
  exactVoicePoolKeys: Set<string>;
} {
  const definitionsDir = path.join(process.cwd(), 'src/utils/exercises/definitions');
  const files = fs
    .readdirSync(definitionsDir)
    .filter((file) => file.endsWith('.ts') && file !== 'register.ts')
    .map((file) => path.join(definitionsDir, file));

  const visualFeedback = new Set<string>([LOW_ROM_FEEDBACK]);
  const exactVoicePoolKeys = new Set<string>([LOW_ROM_FEEDBACK]);

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'push'
      ) {
        const [firstArg] = node.arguments;
        if (firstArg && ts.isStringLiteralLike(firstArg)) {
          visualFeedback.add(firstArg.text);
        }
      }

      if (
        ts.isPropertyAssignment(node) &&
        textOfName(node.name) === 'ttsConfig' &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        const feedbackMessages = findProperty(node.initializer, 'feedbackMessages');
        if (feedbackMessages && ts.isObjectLiteralExpression(feedbackMessages.initializer)) {
          for (const key of collectObjectKeys(feedbackMessages.initializer)) {
            exactVoicePoolKeys.add(key);
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return { visualFeedback, exactVoicePoolKeys };
}

describe('exercise TTS coverage', () => {
  it('maps every exercise feedback literal to a TTS issue with a speakable pool', () => {
    const { visualFeedback, exactVoicePoolKeys } = collectExerciseFeedbackLiterals();

    const missingIssueMappings = Array.from(visualFeedback).filter(
      (feedback) => FEEDBACK_TO_ISSUE[feedback] === undefined
    );
    expect(missingIssueMappings).toEqual([]);

    const missingVoicePools = Object.entries(FEEDBACK_TO_ISSUE)
      .filter(([feedback, issueType]) => {
        const pool = FEEDBACK_TTS_POOLS[feedback] ?? ISSUE_POOLS[issueType];
        return !pool || pool.messages.length < 3;
      })
      .map(([feedback, issueType]) => ({ feedback, issueType }));
    expect(missingVoicePools).toEqual([]);

    const orphanExactVoicePools = Array.from(exactVoicePoolKeys).filter(
      (feedback) => FEEDBACK_TO_ISSUE[feedback] === undefined
    );
    expect(orphanExactVoicePools).toEqual([]);
  });

  it('splits newline-joined form feedback before choosing the highest-priority cue', () => {
    expect(normalizeFeedbackMessages(['A cue.\nB cue.', 'A cue.'])).toEqual([
      'A cue.',
      'B cue.',
    ]);

    const topFeedback = getTopFeedbackIssueCandidate([
      'Slow down the push \u2014 control the movement.\nHips are sagging \u2014 engage your core to maintain a straight line.',
    ]);

    expect(topFeedback?.feedback).toBe(
      'Hips are sagging \u2014 engage your core to maintain a straight line.'
    );
    expect(topFeedback?.issueType).toBe('hip_sag');
  });

  it('uses exact voice pools when a generic issue pool would be too vague', () => {
    const feedback = 'Too much forward lean \u2014 keep your chest up.';
    const topFeedback = getTopFeedbackIssueCandidate([feedback]);

    expect(topFeedback?.pool).toBe(FEEDBACK_TTS_POOLS[feedback]);
    expect(topFeedback?.pool.messages).toContain('Chest up.');
  });
});
