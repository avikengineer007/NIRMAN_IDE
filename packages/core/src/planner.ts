import type { ModelClient } from '@nirman/model';
import type { TaskItem } from '@nirman/artifacts';

export interface PlanGenerationResult {
  planMarkdown: string;
  specMarkdown: string;
  tasks: TaskItem[];
}

/**
 * Extracts JSON content from text (handles markdown code fences if present).
 */
function extractJson(rawText?: string): unknown {
  const text = rawText ?? '';
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const raw = codeBlockMatch ? codeBlockMatch[1] : text;
  try {
    return JSON.parse(raw!.trim());
  } catch {
    // Try finding the first '{' and last '}'
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Parses ordered steps from plan markdown into TaskItem[] array.
 */
export function parsePlanTasks(planMarkdown: string): TaskItem[] {
  const tasks: TaskItem[] = [];

  // Match: ### Step 1: <Title> or ## Step 1: <Title> or Step 1: <Title>
  const stepHeaderRegex = /^(?:#{2,4}\s+)?Step\s+(\d+)\s*[:.-]\s*(.+)$/gim;
  const matches = [...planMarkdown.matchAll(stepHeaderRegex)];

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const stepNum = match[1] ?? `${i + 1}`;
      const title = match[2]!.trim();

      // Extract description between this step header and the next header
      const matchIndex = match.index ?? 0;
      const nextIndex =
        i + 1 < matches.length
          ? (matches[i + 1]!.index ?? planMarkdown.length)
          : planMarkdown.length;
      const stepBlock = planMarkdown.slice(matchIndex + match[0].length, nextIndex);
      const descLines = stepBlock
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      const description = descLines.slice(0, 3).join(' ') || undefined;

      tasks.push({
        id: `step-${stepNum}`,
        title,
        ...(description ? { description } : {}),
        status: 'pending',
      });
    }
    return tasks;
  }

  // Fallback pattern: Numbered list under "Steps" or "Ordered Steps" section
  const sectionHeadingMatch = planMarkdown.match(/#+\s*(?:Ordered\s+)?Steps/i);
  if (sectionHeadingMatch) {
    const afterHeading = planMarkdown.slice(
      sectionHeadingMatch.index! + sectionHeadingMatch[0].length,
    );
    const nextHeadingIndex = afterHeading.search(/\n#+\s+/);
    const sectionText =
      nextHeadingIndex !== -1 ? afterHeading.slice(0, nextHeadingIndex) : afterHeading;
    const listRegex = /^\s*(\d+)\.\s+(.+)$/gm;
    const listMatches = [...sectionText.matchAll(listRegex)];
    for (const lm of listMatches) {
      const num = lm[1]!;
      const rawTitle = lm[2]!.trim().replace(/^\*\*|\*\*$/g, '');
      tasks.push({
        id: `step-${num}`,
        title: rawTitle,
        status: 'pending',
      });
    }
    if (tasks.length > 0) {
      return tasks;
    }
  }

  // Default fallback if no structured steps could be identified
  return [
    {
      id: 'step-1',
      title: 'Execute project plan',
      description: 'Implement the architecture and components specified in plan.md',
      status: 'pending',
    },
  ];
}

/**
 * Splits model response containing PLAN.MD and SPEC.MD sections.
 */
function splitPlanAndSpec(
  rawResponse?: string,
  task = '',
): { planMarkdown: string; specMarkdown: string } {
  const response = rawResponse ?? '';

  // Match headers/delimiters like:
  // === PLAN.MD ===, ### PLAN.MD, # PLAN.MD, ## PLAN, etc.
  const planMarkerRegex = /(?:^|\n)\s*(?:={3,}|#{1,4})\s*PLAN(?:\.MD)?(?:\s*={3,})?\s*(?:\n|$)/i;
  const specMarkerRegex = /(?:^|\n)\s*(?:={3,}|#{1,4})\s*SPEC(?:\.MD)?(?:\s*={3,})?\s*(?:\n|$)/i;

  const planMatch = planMarkerRegex.exec(response);
  const specMatch = specMarkerRegex.exec(response);

  if (planMatch && specMatch) {
    if (planMatch.index < specMatch.index) {
      const planPart = response.slice(planMatch.index + planMatch[0].length, specMatch.index);
      const specPart = response.slice(specMatch.index + specMatch[0].length);
      return {
        planMarkdown: planPart.trim(),
        specMarkdown: specPart.trim(),
      };
    } else {
      const specPart = response.slice(specMatch.index + specMatch[0].length, planMatch.index);
      const planPart = response.slice(planMatch.index + planMatch[0].length);
      return {
        planMarkdown: planPart.trim(),
        specMarkdown: specPart.trim(),
      };
    }
  }

  // If only SPEC marker exists
  if (specMatch) {
    const planPart = response.slice(0, specMatch.index);
    const specPart = response.slice(specMatch.index + specMatch[0].length);
    return {
      planMarkdown: planPart.trim(),
      specMarkdown: specPart.trim(),
    };
  }

  // Fallback: If no markers found, use entire text as plan and generate a default SPEC.md
  const testCmdMatch = task.match(/test\s*command:\s*`?([^`\n]+)`?/i);
  const testCmd = testCmdMatch && testCmdMatch[1] ? testCmdMatch[1].trim() : 'npm test';

  return {
    planMarkdown: response.trim(),
    specMarkdown: `# Project Specification\n\nTask: ${task}\n\n## Conventions\n- Clean architecture\n\n## Commands\n- Build: None\n- Test: ${testCmd}\n`,
  };
}

export class Planner {
  /**
   * Generates at most 3 clarifying questions only if essential.
   * Returns empty array if task is clear or self-contained.
   */
  async generateClarifications(task: string, modelClient: ModelClient): Promise<string[]> {
    const prompt = `You are NIRMAN's Project Architect.
A user has requested:
"${task}"

Determine if any clarifying questions are ESSENTIAL before creating an execution plan and technical specification.
Rules:
1. Ask AT MOST 3 questions.
2. Ask questions ONLY if essential (e.g. ambiguity that would prevent choosing the right stack, major feature scope, or target platform).
3. If the task is clear, standard, or reasonable defaults can be assumed, return an empty array.
4. Output MUST be valid JSON with this exact schema:
{
  "questions": ["Question 1", "Question 2"]
}
Or if no questions are needed:
{
  "questions": []
}`;

    const response = await modelClient.chat([
      {
        role: 'system',
        content:
          'You are an expert software architect that asks concise, essential clarifying questions.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ]);

    const responseText = response.message.content ?? response.rawText;
    const parsed = extractJson(responseText) as { questions?: unknown } | null;
    if (parsed && Array.isArray(parsed.questions)) {
      const validQuestions = parsed.questions
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .slice(0, 3);
      return validQuestions;
    }

    return [];
  }

  /**
   * Generates plan.md (stack, folder structure, ordered steps, test strategy)
   * and SPEC.md (stack, conventions, commands to build/test/run).
   */
  async generatePlan(
    task: string,
    clarifications: Record<string, string>,
    modelClient: ModelClient,
  ): Promise<PlanGenerationResult> {
    const clarificationsText =
      Object.keys(clarifications).length > 0
        ? Object.entries(clarifications)
            .map(([q, a]) => `Q: ${q}\nA: ${a}`)
            .join('\n\n')
        : 'None provided (use sensible production-ready defaults).';

    const prompt = `You are NIRMAN's Project Architect.
Project Request:
"${task}"

Clarifications:
${clarificationsText}

Important Requirements:
1. The workspace directory is the root of the project. Do NOT create an extra enclosing folder for the project; all files must be placed directly in the workspace root or standard subdirectories (e.g., src/).
2. Keep the plan concise and high-level: 1 to 3 logical steps (e.g., Step 1: Implement application code and dependencies; Step 2: Verification and test cases). Do NOT create 10+ microscopic steps for individual terminal commands.
3. Under SPEC.md "Build / Test / Run Commands", list the exact commands. If the user provided a test command in the project request, use it directly (e.g. \`- Test: node wordcount.js sample.txt\`). If no build step is needed, write \`- Build: None\`.

Create two comprehensive artifacts:
1. plan.md:
   - Stack: Selected frameworks, libraries, runtime, and versions.
   - Folder Structure: Directory layout of the project.
   - Ordered Steps: Each step MUST have heading:
     ### Step <number>: <Title>
     <Brief description of what files will be created/tested>
   - Test Strategy: How the project will be tested and verified.

2. SPEC.md:
   - Overview & Goals
   - Stack & Conventions
   - Build / Test / Run Commands

Separate the two files using the exact markers:
=== PLAN.MD ===
<plan markdown>
=== SPEC.MD ===
<spec markdown>`;

    const response = await modelClient.chat([
      {
        role: 'system',
        content:
          'You are a senior software architect. Provide clear, concrete, actionable plans and specifications.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ]);

    const responseText = response.message.content ?? response.rawText;
    const { planMarkdown, specMarkdown } = splitPlanAndSpec(responseText, task);
    const tasks = parsePlanTasks(planMarkdown);

    return {
      planMarkdown,
      specMarkdown,
      tasks,
    };
  }

  /**
   * Revises plan.md and SPEC.md based on user comments/feedback.
   */
  async revisePlan(
    task: string,
    currentPlan: string,
    currentSpec: string,
    feedback: string,
    modelClient: ModelClient,
  ): Promise<PlanGenerationResult> {
    const prompt = `You are NIRMAN's Project Architect.
Original Task:
"${task}"

Current plan.md:
${currentPlan}

Current SPEC.md:
${currentSpec}

User Feedback / Revision Request:
"${feedback}"

Revise both plan.md and SPEC.md to address the feedback. Keep the ordered steps format:
### Step <number>: <Title>
<Description>

Output format:
=== PLAN.MD ===
<revised plan markdown>
=== SPEC.MD ===
<revised spec markdown>`;

    const response = await modelClient.chat([
      {
        role: 'system',
        content:
          'You are a senior software architect. Update plans cleanly based on user feedback.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ]);

    const responseText = response.message.content ?? response.rawText;
    const { planMarkdown, specMarkdown } = splitPlanAndSpec(responseText, task);
    const tasks = parsePlanTasks(planMarkdown);

    return {
      planMarkdown,
      specMarkdown,
      tasks,
    };
  }
}
