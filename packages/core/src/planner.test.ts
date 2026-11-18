import { describe, expect, it } from 'vitest';
import { MockModelClient } from '@nirman/model';
import { Planner, parsePlanTasks } from './planner.js';

describe('Planner', () => {
  const planner = new Planner();

  describe('generateClarifications', () => {
    it('returns empty array when model determines no questions are needed', async () => {
      const mockModel = new MockModelClient([
        {
          response: '{"questions": []}',
        },
      ]);

      const questions = await planner.generateClarifications(
        'Build a simple hello world CLI',
        mockModel,
      );
      expect(questions).toEqual([]);
    });

    it('returns at most 3 questions from model JSON response', async () => {
      const mockModel = new MockModelClient([
        {
          response: `\`\`\`json
{
  "questions": [
    "Which database do you prefer (PostgreSQL, SQLite, MongoDB)?",
    "Do you need JWT or session-based authentication?",
    "Should we include a frontend or only REST API?",
    "Extra question that should be truncated"
  ]
}
\`\`\``,
        },
      ]);

      const questions = await planner.generateClarifications(
        'Build a to-do web app with login',
        mockModel,
      );
      expect(questions).toHaveLength(3);
      expect(questions[0]).toContain('Which database');
      expect(questions[1]).toContain('authentication');
      expect(questions[2]).toContain('frontend');
    });

    it('gracefully handles non-JSON responses', async () => {
      const mockModel = new MockModelClient([
        {
          response: 'I am not sure what questions to ask.',
        },
      ]);

      const questions = await planner.generateClarifications('Build something', mockModel);
      expect(questions).toEqual([]);
    });
  });

  describe('parsePlanTasks', () => {
    it('extracts steps using ### Step X: format', () => {
      const plan = `
# Plan for To-Do Web App

## Architecture
Node.js + Express + SQLite

## Steps
### Step 1: Project Setup
Initialize package.json and install dependencies.

### Step 2: Database Schema
Create SQLite database migrations and schema for users and tasks.

### Step 3: API Routes & Verification
Implement REST endpoints and run unit tests.
`;

      const tasks = parsePlanTasks(plan);
      expect(tasks).toHaveLength(3);
      expect(tasks[0]?.id).toBe('step-1');
      expect(tasks[0]?.title).toBe('Project Setup');
      expect(tasks[0]?.description).toContain('Initialize package.json');
      expect(tasks[0]?.status).toBe('pending');

      expect(tasks[1]?.id).toBe('step-2');
      expect(tasks[1]?.title).toBe('Database Schema');

      expect(tasks[2]?.id).toBe('step-3');
      expect(tasks[2]?.title).toBe('API Routes & Verification');
    });

    it('extracts numbered list under Steps section', () => {
      const plan = `
# Plan

## Ordered Steps
1. Initialize repository with TypeScript
2. Build data model
3. Add Playwright browser tests
`;

      const tasks = parsePlanTasks(plan);
      expect(tasks).toHaveLength(3);
      expect(tasks[0]?.id).toBe('step-1');
      expect(tasks[0]?.title).toBe('Initialize repository with TypeScript');
      expect(tasks[1]?.id).toBe('step-2');
      expect(tasks[2]?.id).toBe('step-3');
    });

    it('returns fallback task if no steps are found', () => {
      const plan = 'Just a general unformatted text plan';
      const tasks = parsePlanTasks(plan);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.id).toBe('step-1');
      expect(tasks[0]?.title).toBe('Execute project plan');
    });
  });

  describe('generatePlan & revisePlan', () => {
    it('generates plan.md and SPEC.md correctly', async () => {
      const mockModel = new MockModelClient([
        {
          response: `=== PLAN.MD ===
# Execution Plan

### Step 1: Initialize Project
Create package.json and tsconfig.json.

### Step 2: Implement Core Logic
Build application modules.

=== SPEC.MD ===
# Project Spec
- Stack: TypeScript, Node.js
- Commands:
  - npm run build
  - npm test
`,
        },
      ]);

      const result = await planner.generatePlan(
        'Build a TypeScript tool',
        { 'Which runtime?': 'Node.js 20' },
        mockModel,
      );

      expect(result.planMarkdown).toContain('### Step 1: Initialize Project');
      expect(result.specMarkdown).toContain('# Project Spec');
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0]?.id).toBe('step-1');
    });

    it('revises plan based on user feedback', async () => {
      const mockModel = new MockModelClient([
        {
          response: `=== PLAN.MD ===
# Revised Execution Plan

### Step 1: Initialize Project with PostgreSQL
Use PostgreSQL instead of SQLite.

=== SPEC.MD ===
# Revised Spec
- Database: PostgreSQL
`,
        },
      ]);

      const result = await planner.revisePlan(
        'Build a web app',
        '# Old Plan',
        '# Old Spec',
        'Please switch from SQLite to PostgreSQL',
        mockModel,
      );

      expect(result.planMarkdown).toContain('PostgreSQL');
      expect(result.specMarkdown).toContain('PostgreSQL');
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]?.title).toContain('PostgreSQL');
    });
  });
});
