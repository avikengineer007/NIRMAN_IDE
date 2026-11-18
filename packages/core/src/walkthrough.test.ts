import { describe, expect, it } from 'vitest';
import { generateWalkthrough } from './walkthrough.js';

describe('generateWalkthrough', () => {
  it('generates markdown walkthrough report with tasks and commands', () => {
    const md = generateWalkthrough({
      task: 'Build a REST API',
      runId: 'run_123',
      status: 'completed',
      specMarkdown: `
# Spec
- Run: node server.js
- Test: npm test
`,
      tasks: [
        { id: 'step-1', title: 'Setup database', status: 'completed' },
        { id: 'step-2', title: 'Build endpoints', status: 'completed' },
      ],
      createdFiles: ['server.js', 'db.js'],
    });

    expect(md).toContain('# Project Walkthrough: Build a REST API');
    expect(md).toContain('`run_123`');
    expect(md).toContain('node server.js');
    expect(md).toContain('npm test');
    expect(md).toContain('`server.js`');
    expect(md).toContain('`step-1`');
    expect(md).toContain('No blocking failures encountered');
  });

  it('documents blocked tasks and error details when retries are exhausted', () => {
    const md = generateWalkthrough({
      task: 'Build faulty app',
      runId: 'run_456',
      status: 'blocked',
      tasks: [
        {
          id: 'step-1',
          title: 'Implement broken feature',
          status: 'blocked',
          retries: 3,
          error: 'AssertionError: test failed',
        },
      ],
    });

    expect(md).toContain('🛑 BLOCKED');
    expect(md).toContain('Task `step-1`: Implement broken feature');
    expect(md).toContain('AssertionError: test failed');
  });
});
