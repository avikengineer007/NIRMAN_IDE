import path from 'node:path';
import { createRequire } from 'node:module';
import Parser from 'web-tree-sitter';
import type { IndexedSymbol } from './types.js';

type SyntaxNode = Parser.SyntaxNode;

const require = createRequire(import.meta.url);

let initialized = false;
const loadedLanguages = new Map<string, Parser.Language>();

/**
 * Initializes web-tree-sitter and pre-loads languages.
 */
async function ensureTreeSitterInit(): Promise<void> {
  if (initialized) {
    return;
  }
  await Parser.init();
  initialized = true;
}

/**
 * Resolves the path to a grammar wasm from the tree-sitter-wasms package.
 */
function getWasmPath(langName: string): string {
  const wasmsPkg = require.resolve('tree-sitter-wasms/package.json');
  return path.join(path.dirname(wasmsPkg), 'out', `tree-sitter-${langName}.wasm`);
}

/**
 * Gets or loads a TreeSitter Language for the given language identifier.
 */
async function getLanguage(
  lang: 'typescript' | 'javascript' | 'python' | 'tsx',
): Promise<Parser.Language | null> {
  await ensureTreeSitterInit();

  if (loadedLanguages.has(lang)) {
    return loadedLanguages.get(lang)!;
  }

  try {
    const wasmFile = getWasmPath(lang);
    const language = await Parser.Language.load(wasmFile);
    loadedLanguages.set(lang, language);
    return language;
  } catch {
    return null;
  }
}

/**
 * Maps file extension to tree-sitter language identifier.
 */
function getLanguageForExt(ext: string): 'typescript' | 'javascript' | 'python' | 'tsx' | null {
  switch (ext.toLowerCase()) {
    case '.ts':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.mjs':
    case '.cjs':
    case '.jsx':
      return 'javascript';
    case '.py':
      return 'python';
    default:
      return null;
  }
}

/**
 * Extracts line range (1-indexed) and first signature line from a node.
 */
function getNodeInfo(node: SyntaxNode): { startLine: number; endLine: number; signature: string } {
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const firstLine = (node.text.split('\n')[0] ?? '').trim().slice(0, 160);
  return { startLine, endLine, signature: firstLine };
}

/**
 * Traverses TreeSitter syntax tree and extracts code symbols.
 */
function extractSymbolsFromTree(
  root: SyntaxNode,
  filePath: string,
  lang: string,
): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = [];

  function visit(node: SyntaxNode): void {
    const type = node.type;

    // TypeScript / JavaScript functions
    if (
      type === 'function_declaration' ||
      type === 'generator_function_declaration'
    ) {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : '(anonymous function)';
      const { startLine, endLine, signature } = getNodeInfo(node);
      symbols.push({
        id: `${filePath}#${name}:${startLine}`,
        filePath,
        name,
        kind: 'function',
        startLine,
        endLine,
        signature,
      });
    } else if (type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : '(anonymous method)';
      const { startLine, endLine, signature } = getNodeInfo(node);
      symbols.push({
        id: `${filePath}#${name}:${startLine}`,
        filePath,
        name,
        kind: 'method',
        startLine,
        endLine,
        signature,
      });
    } else if (type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : '(anonymous class)';
      const { startLine, endLine, signature } = getNodeInfo(node);
      symbols.push({
        id: `${filePath}#${name}:${startLine}`,
        filePath,
        name,
        kind: 'class',
        startLine,
        endLine,
        signature,
      });
    } else if (type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : '(interface)';
      const { startLine, endLine, signature } = getNodeInfo(node);
      symbols.push({
        id: `${filePath}#${name}:${startLine}`,
        filePath,
        name,
        kind: 'interface',
        startLine,
        endLine,
        signature,
      });
    } else if (type === 'type_alias_declaration') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : '(type)';
      const { startLine, endLine, signature } = getNodeInfo(node);
      symbols.push({
        id: `${filePath}#${name}:${startLine}`,
        filePath,
        name,
        kind: 'type',
        startLine,
        endLine,
        signature,
      });
    } else if (type === 'export_statement') {
      // Export statement wrapper - visit children to extract inner exported declarations
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) visit(child);
      }
      return;
    } else if (lang === 'python') {
      if (type === 'function_definition') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : '(function)';
        const { startLine, endLine, signature } = getNodeInfo(node);
        symbols.push({
          id: `${filePath}#${name}:${startLine}`,
          filePath,
          name,
          kind: 'function',
          startLine,
          endLine,
          signature,
        });
      } else if (type === 'class_definition') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : '(class)';
        const { startLine, endLine, signature } = getNodeInfo(node);
        symbols.push({
          id: `${filePath}#${name}:${startLine}`,
          filePath,
          name,
          kind: 'class',
          startLine,
          endLine,
          signature,
        });
      }
    }

    // Recurse children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        visit(child);
      }
    }
  }

  visit(root);
  return symbols;
}

/**
 * Fallback regex-based symbol extractor for languages without tree-sitter wasm or on parse error.
 */
function extractSymbolsFallback(content: string, filePath: string): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = i + 1;

    // Functions: function foo( or def foo( or const foo = (...) =>
    const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?(?:function\s+|def\s+)([A-Za-z0-9_$]+)/);
    if (fnMatch && fnMatch[1]) {
      symbols.push({
        id: `${filePath}#${fnMatch[1]}:${lineNum}`,
        filePath,
        name: fnMatch[1],
        kind: 'function',
        startLine: lineNum,
        endLine: lineNum,
        signature: line.slice(0, 120),
      });
      continue;
    }

    // Arrow functions / const declarations
    const constFnMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/);
    if (constFnMatch && constFnMatch[1]) {
      symbols.push({
        id: `${filePath}#${constFnMatch[1]}:${lineNum}`,
        filePath,
        name: constFnMatch[1],
        kind: 'function',
        startLine: lineNum,
        endLine: lineNum,
        signature: line.slice(0, 120),
      });
      continue;
    }

    // Classes
    const classMatch = line.match(/(?:export\s+)?class\s+([A-Za-z0-9_$]+)/);
    if (classMatch && classMatch[1]) {
      symbols.push({
        id: `${filePath}#${classMatch[1]}:${lineNum}`,
        filePath,
        name: classMatch[1],
        kind: 'class',
        startLine: lineNum,
        endLine: lineNum,
        signature: line.slice(0, 120),
      });
      continue;
    }

    // Interfaces & Types
    const ifaceMatch = line.match(/(?:export\s+)?(?:interface|type)\s+([A-Za-z0-9_$]+)/);
    if (ifaceMatch && ifaceMatch[1]) {
      symbols.push({
        id: `${filePath}#${ifaceMatch[1]}:${lineNum}`,
        filePath,
        name: ifaceMatch[1],
        kind: ifaceMatch[0].includes('interface') ? 'interface' : 'type',
        startLine: lineNum,
        endLine: lineNum,
        signature: line.slice(0, 120),
      });
      continue;
    }
  }

  return symbols;
}

/**
 * Extracts symbols from file content using TreeSitter if supported, otherwise regex fallback.
 */
export async function extractSymbols(
  content: string,
  filePath: string,
): Promise<IndexedSymbol[]> {
  const ext = path.extname(filePath);
  const lang = getLanguageForExt(ext);

  if (lang) {
    const language = await getLanguage(lang);
    if (language) {
      try {
        const parser = new Parser();
        parser.setLanguage(language);
        const tree = parser.parse(content);
        return extractSymbolsFromTree(tree.rootNode, filePath, lang);
      } catch {
        // Fall back to regex on tree-sitter parse failure
      }
    }
  }

  return extractSymbolsFallback(content, filePath);
}

/**
 * Generates a concise per-file summary from file content and extracted symbols.
 */
export function generateFileSummary(
  filePath: string,
  content: string,
  symbols: readonly IndexedSymbol[],
): string {
  const lines = content.split('\n');
  const nonBlank = lines.filter((l) => l.trim().length > 0);

  // Check for top-level comment or docstring
  let docstring = '';
  const firstLines = lines.slice(0, 10).map((l) => l.trim());
  const blockCommentStart = firstLines.findIndex(
    (l) => l.startsWith('/*') || l.startsWith('"""') || l.startsWith("'''"),
  );
  if (blockCommentStart !== -1) {
    const commentLines: string[] = [];
    for (let i = blockCommentStart; i < Math.min(lines.length, blockCommentStart + 6); i++) {
      const clean = lines[i]!.replace(/^\/?\*+\/?/, '').replace(/^["']{3}/, '').trim();
      if (clean.length > 0) commentLines.push(clean);
      if (
        lines[i]!.includes('*/') ||
        (i > blockCommentStart && (lines[i]!.includes('"""') || lines[i]!.includes("'''")))
      ) {
        break;
      }
    }
    docstring = commentLines.join(' ').slice(0, 150);
  } else {
    // Check for leading // comments
    const lineComments = firstLines
      .filter((l) => l.startsWith('//') || l.startsWith('#'))
      .map((l) => l.replace(/^\/{2,}|#+/, '').trim())
      .filter((l) => l.length > 0);
    if (lineComments.length > 0) {
      docstring = lineComments.join(' ').slice(0, 150);
    }
  }

  const symbolSummary = symbols.slice(0, 6).map((s) => `${s.kind} ${s.name}`).join(', ');
  const symbolCount = symbols.length;

  const parts: string[] = [];
  if (docstring) {
    parts.push(docstring);
  }
  if (symbolCount > 0) {
    parts.push(
      `Defines ${symbolCount} symbol(s): ${symbolSummary}${symbolCount > 6 ? ', ...' : ''}`,
    );
  } else {
    parts.push(`${nonBlank.length} line(s) in ${path.basename(filePath)}`);
  }

  return parts.join(' | ').slice(0, 250);
}
