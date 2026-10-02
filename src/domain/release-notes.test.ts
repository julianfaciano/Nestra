import { describe, expect, it } from 'vitest';
import {
  CURRENT_RELEASE,
  CURRENT_RELEASE_VERSION,
  RELEASE_NOTES,
} from './release-notes';

describe('release notes', () => {
  it('declares 0.3.0 as the current release and latest entry', () => {
    expect(CURRENT_RELEASE_VERSION).toBe('0.3.0');
    expect(CURRENT_RELEASE.version).toBe('0.3.0');
    expect(RELEASE_NOTES[0]).toBe(CURRENT_RELEASE);
  });

  it('keeps releases newest first and includes the five approved versions', () => {
    expect(RELEASE_NOTES.map(({ version }) => version)).toEqual([
      '0.3.0',
      '0.2.0',
      '0.1.1',
      '0.1.0',
      '0.0.0',
    ]);
    expect(RELEASE_NOTES.map(({ date }) => date)).toEqual(
      [...RELEASE_NOTES.map(({ date }) => date)].sort().reverse(),
    );
  });

  it('marks only the baseline Alpha and all following versions Beta', () => {
    expect(
      RELEASE_NOTES.filter(({ stage }) => stage === 'alpha').map(
        ({ version }) => version,
      ),
    ).toEqual(['0.0.0']);
    expect(RELEASE_NOTES.filter(({ stage }) => stage === 'beta')).toHaveLength(
      4,
    );
    expect(RELEASE_NOTES.every(({ changes }) => changes.length >= 2)).toBe(
      true,
    );
    expect(
      RELEASE_NOTES.slice(0, 3).every(({ changes }) => changes.length <= 4),
    ).toBe(true);
  });
});
