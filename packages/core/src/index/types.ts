/**
 * Types and interfaces for NIRMAN Repository Indexing and Retrieval.
 */

export interface IndexedFile {
  path: string;
  extension: string;
  sizeBytes: number;
  lineCount: number;
  summary: string;
  mtimeMs: number;
}

export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'constant'
  | 'module';

export interface IndexedSymbol {
  id: string;
  filePath: string;
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature: string;
  docstring?: string | undefined;
}

export interface IndexedSnippet {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  tokenCount: number;
  embedding?: Float32Array | undefined;
}

export interface RetrievedSnippet {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  tokenCount: number;
  score: number;
  matchedSymbols: string[];
  reason: string;
}

export interface IndexConfig {
  /** Database file path on host, or ':memory:' for transient index */
  dbPath?: string;
  /** Dimension for local vector embeddings (default: 256) */
  embeddingDimension?: number;
  /** Max file size in bytes to index (default: 512 * 1024) */
  maxFileSize?: number;
  /** Target lines per snippet chunk (default: 40) */
  snippetLines?: number;
  /** Line overlap between adjacent snippets (default: 10) */
  snippetOverlap?: number;
  /** Directory names or glob fragments to exclude */
  excludePatterns?: string[];
}

export interface RetrievalOptions {
  /** Maximum total tokens across all returned snippets (default: 4000) */
  maxTokens?: number;
  /** Maximum number of snippets to return (default: 10) */
  maxSnippets?: number;
  /** Minimum relevance score cutoff in [0, 1] (default: 0.15) */
  minScore?: number;
  /** Optional file path filter (e.g. only files in 'src/') */
  pathPrefix?: string;
}
