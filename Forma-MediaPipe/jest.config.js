module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/scripts'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '<rootDir>/scripts/**/*.test.ts',
    '<rootDir>/scripts/replay.ts',
    '<rootDir>/scripts/dataset-draft-label.ts',
    '<rootDir>/scripts/dataset-evaluate.ts',
    '<rootDir>/scripts/dataset-prepare.ts',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js'],
};
