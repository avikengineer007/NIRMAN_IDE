import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  ArtifactStore,
  generateRunId,
  createRunStartedEvent,
  formatEventLog,
} from './index.js';

describe('@nirman/artifacts exports', () => {
  it('exports package name and key store / event functions', () => {
    expect(PACKAGE_NAME).toBe('@nirman/artifacts');
    expect(typeof ArtifactStore).toBe('function');
    expect(typeof generateRunId).toBe('function');
    expect(typeof createRunStartedEvent).toBe('function');
    expect(typeof formatEventLog).toBe('function');
  });
});
