const fs = require('fs');
const path = require('path');

const definitionsDir = path.join(__dirname, '..', 'src', 'utils', 'exercises', 'definitions');

const ALLOWLIST = new Set([
  'x: (leftHip.x + rightHip.x) / 2,',
  'y: (leftHip.y + rightHip.y) / 2,',
  'x: (leftShoulder.x + rightShoulder.x) / 2,',
  'y: (leftShoulder.y + rightShoulder.y) / 2,',
  'shoulderX = (ls!.x + rs!.x) / 2;',
  'shoulderY = (ls!.y + rs!.y) / 2;',
  'hipX = (lh!.x + rh!.x) / 2;',
  'hipY = (lh!.y + rh!.y) / 2;',
  'x: (ls!.x + rs!.x) / 2,',
  'y: (ls!.y + rs!.y) / 2,',
  'x: (lh!.x + rh!.x) / 2,',
  'y: (lh!.y + rh!.y) / 2,',
  'const midHipY = (leftHip.y + rightHip.y) / 2;',
  'const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;',
  'const midShoulderX = (leftShoulder.x + rightShoulder.x) / 2;',
  'const midHipX = (leftHip.x + rightHip.x) / 2;',
  'const midShoulderY = (ls!.y + rs!.y) / 2;',
  'const midHipY = (lh!.y + rh!.y) / 2;',
  'const v1x = hipPt.x - shoulderPt.x;',
  'const v1y = hipPt.y - shoulderPt.y;',
  'const v2x = elbowPt.x - shoulderPt.x;',
  'const v2y = elbowPt.y - shoulderPt.y;',
]);

function scanDefinitionCoordinateLiterals() {
  const violations = [];
  const files = fs.readdirSync(definitionsDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => path.join(definitionsDir, file));

  const numericLiteral = '(?<![A-Za-z0-9_])-?\\d+(?:\\.\\d+)?\\b';
  const pattern = new RegExp(`(?:\\.[xy]\\b.*${numericLiteral})|(?:${numericLiteral}.*\\.[xy]\\b)`);

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!pattern.test(trimmed)) return;
      if (ALLOWLIST.has(trimmed)) return;
      violations.push(`${path.relative(path.join(__dirname, '..'), file)}:${index + 1}: ${trimmed}`);
    });
  }

  return violations;
}

if (require.main === module) {
  const violations = scanDefinitionCoordinateLiterals();
  if (violations.length > 0) {
    console.error('Coordinate numeric literal audit failed:');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exit(1);
  }
}

module.exports = { scanDefinitionCoordinateLiterals };
