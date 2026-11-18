import path from 'node:path';

/**
 * Error thrown when a path attempts to escape the designated workspace boundary.
 */
export class PathEscapeError extends Error {
  constructor(attemptedPath: string, workspaceRoot: string) {
    super(
      `Access denied: path "${attemptedPath}" escapes the workspace boundary "${workspaceRoot}"`,
    );
    this.name = 'PathEscapeError';
  }
}

/**
 * Safely resolves a target path relative to workspaceRoot.
 * Guarantees the resolved path is strictly within workspaceRoot.
 *
 * @param workspaceRoot Absolute path to workspace root
 * @param targetPath Relative or absolute target path
 * @returns Fully resolved, normalized absolute path
 * @throws PathEscapeError if the target path attempts to escape workspaceRoot
 */
export function resolveSafePath(workspaceRoot: string, targetPath: string): string {
  const normalizedRoot = path.resolve(workspaceRoot);

  // If path is absolute, check if it points within workspaceRoot
  let resolved: string;
  if (path.isAbsolute(targetPath)) {
    resolved = path.resolve(targetPath);
  } else {
    resolved = path.resolve(normalizedRoot, targetPath);
  }

  // Windows drive letter / casing normalization
  const rootLower = normalizedRoot.toLowerCase();
  const resolvedLower = resolved.toLowerCase();

  // The resolved path must equal root or start with root + path.sep
  const isInside =
    resolvedLower === rootLower || resolvedLower.startsWith(`${rootLower}${path.sep}`);

  if (!isInside) {
    throw new PathEscapeError(targetPath, normalizedRoot);
  }

  return resolved;
}

/**
 * Computes a relative path from workspaceRoot for clean reporting,
 * using forward slashes regardless of OS.
 */
export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  const rel = path.relative(workspaceRoot, absolutePath);
  if (!rel) {
    return '.';
  }
  return rel.split(path.sep).join('/');
}
