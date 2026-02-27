module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/scripts'],
  testMatch: ['**/__tests__/**/*.test.ts', '<rootDir>/scripts/replay.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js'],
};
