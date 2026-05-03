const { scanDefinitionCoordinateLiterals } = require('./audit-definition-coordinate-literals');

describe('definition coordinate literal audit', () => {
  it('passes against the Phase 4 allowlist', () => {
    expect(scanDefinitionCoordinateLiterals()).toEqual([]);
  });
});
