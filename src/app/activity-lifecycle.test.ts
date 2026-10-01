import { expect, it } from 'vitest';
import { completedActivityCleanup } from './activity-lifecycle';

it('clears completed activity after leaving Production once the result was visible there', () => {
  expect(completedActivityCleanup('batch', 'jobs', true, 'completed', 'completed')).toEqual({ optimization: true, export: true });
});

it('keeps completion until Production was visited and keeps any still-running operation', () => {
  expect(completedActivityCleanup('batch', 'home', false, 'completed', 'idle')).toEqual({ optimization: false, export: false });
  expect(completedActivityCleanup('batch', 'home', true, 'completed', 'running')).toEqual({ optimization: false, export: false });
});

it('does not change error, cancelled, idle, or same-page activity', () => {
  expect(completedActivityCleanup('batch', 'batch', true, 'completed', 'idle')).toEqual({ optimization: false, export: false });
  expect(completedActivityCleanup('batch', 'home', true, 'error', 'cancelled')).toEqual({ optimization: false, export: false });
});
