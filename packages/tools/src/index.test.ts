import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  createDefaultToolRegistry,
  ToolRegistry,
  truncateOutput,
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  searchTool,
  runShellTool,
} from './index.js';

describe('@nirman/tools exports', () => {
  it('exports package name and all core tools and registry', () => {
    expect(PACKAGE_NAME).toBe('@nirman/tools');
    expect(typeof ToolRegistry).toBe('function');
    expect(typeof createDefaultToolRegistry).toBe('function');
    expect(typeof truncateOutput).toBe('function');
    expect(typeof readFileTool.execute).toBe('function');
    expect(typeof writeFileTool.execute).toBe('function');
    expect(typeof editFileTool.execute).toBe('function');
    expect(typeof listDirTool.execute).toBe('function');
    expect(typeof searchTool.execute).toBe('function');
    expect(typeof runShellTool.execute).toBe('function');
  });
});
