import fs from 'node:fs/promises';
import path from 'node:path';
import { ALL_EVAL_TASKS } from './tasks.js';

export async function writeAllTasksToFolder(targetDir?: string): Promise<string[]> {
  const dir = targetDir ?? path.resolve(import.meta.dirname, '..', 'tasks');
  await fs.mkdir(dir, { recursive: true });

  const writtenFiles: string[] = [];

  for (const task of ALL_EVAL_TASKS) {
    const filePath = path.join(dir, `${task.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(task, null, 2), 'utf-8');
    writtenFiles.push(filePath);
  }

  return writtenFiles;
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('task-writer.js') || process.argv[1]?.endsWith('task-writer.ts')) {
  void writeAllTasksToFolder().then((files) => {
    console.log(`Wrote ${files.length} evaluation tasks to disk.`);
  });
}
