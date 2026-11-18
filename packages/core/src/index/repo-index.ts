import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { countTokens } from '@nirman/model';
import type { Sandbox } from '@nirman/sandbox';
import {
  bufferToVector,
  generateLocalEmbedding,
  cosineSimilarity,
  vectorToBuffer,
  tokenizeForEmbedding,
  type EmbeddingProvider,
} from './embeddings.js';
import { extractSymbols, generateFileSummary } from './symbol-extractor.js';
import type {
  IndexConfig,
  IndexedFile,
  IndexedSnippet,
  IndexedSymbol,
  RetrievalOptions,
  RetrievedSnippet,
} from './types.js';

export const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.agent',
  '.vscode',
  '.idea',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];

export class RepoIndex {
  private db: DatabaseSync;
  private readonly config: Required<IndexConfig>;
  private readonly embeddingProvider?: EmbeddingProvider | undefined;

  constructor(
    private readonly workspaceRoot: string,
    config?: IndexConfig,
    embeddingProvider?: EmbeddingProvider,
  ) {
    this.config = {
      dbPath: config?.dbPath ?? ':memory:',
      embeddingDimension: config?.embeddingDimension ?? 256,
      maxFileSize: config?.maxFileSize ?? 512 * 1024,
      snippetLines: config?.snippetLines ?? 40,
      snippetOverlap: config?.snippetOverlap ?? 10,
      excludePatterns: config?.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS,
    };
    this.embeddingProvider = embeddingProvider;

    if (this.config.dbPath !== ':memory:') {
      const dir = path.dirname(this.config.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.config.dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        extension TEXT,
        size_bytes INTEGER,
        line_count INTEGER,
        summary TEXT,
        mtime_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        file_path TEXT,
        name TEXT,
        kind TEXT,
        start_line INTEGER,
        end_line INTEGER,
        signature TEXT,
        docstring TEXT
      );

      CREATE TABLE IF NOT EXISTS snippets (
        id TEXT PRIMARY KEY,
        file_path TEXT,
        start_line INTEGER,
        end_line INTEGER,
        content TEXT,
        token_count INTEGER,
        embedding BLOB
      );

      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_snippets_file ON snippets(file_path);
    `);
  }

  /**
   * Chunks a file content into overlapping line ranges.
   */
  private chunkIntoSnippets(filePath: string, content: string): IndexedSnippet[] {
    const lines = content.split('\n');
    const totalLines = lines.length;
    const chunkSize = this.config.snippetLines;
    const overlap = this.config.snippetOverlap;
    const snippets: IndexedSnippet[] = [];

    if (totalLines <= chunkSize) {
      return [
        {
          id: `${filePath}#1-${totalLines}`,
          filePath,
          startLine: 1,
          endLine: totalLines,
          content,
          tokenCount: countTokens(content),
        },
      ];
    }

    let start = 0;
    while (start < totalLines) {
      const end = Math.min(start + chunkSize, totalLines);
      const sliceLines = lines.slice(start, end);
      const chunkContent = sliceLines.join('\n');
      const startLine = start + 1;
      const endLine = end;

      snippets.push({
        id: `${filePath}#${startLine}-${endLine}`,
        filePath,
        startLine,
        endLine,
        content: chunkContent,
        tokenCount: countTokens(chunkContent),
      });

      if (end >= totalLines) {
        break;
      }
      start += chunkSize - overlap;
    }

    return snippets;
  }

  /**
   * Indexes a single file content into SQLite.
   */
  async indexFile(relativePath: string, content: string, mtimeMs: number = Date.now()): Promise<void> {
    const normPath = relativePath.replace(/\\/g, '/');
    const ext = path.extname(normPath);
    const lines = content.split('\n');
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    // Extract symbols and summary
    const symbols = await extractSymbols(content, normPath);
    const summary = generateFileSummary(normPath, content, symbols);

    // Chunk into snippets
    const snippets = this.chunkIntoSnippets(normPath, content);

    // Generate embeddings for snippets
    let embeddings: Float32Array[];
    if (this.embeddingProvider) {
      embeddings = await this.embeddingProvider(snippets.map((s) => `${normPath}\n${s.content}`));
    } else {
      embeddings = snippets.map((s) =>
        generateLocalEmbedding(`${normPath}\n${summary}\n${s.content}`, this.config.embeddingDimension),
      );
    }

    // Begin SQLite Transaction
    this.db.exec('BEGIN TRANSACTION');
    try {
      // 1. Upsert file
      const upsertFile = this.db.prepare(`
        INSERT INTO files (path, extension, size_bytes, line_count, summary, mtime_ms)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          extension = excluded.extension,
          size_bytes = excluded.size_bytes,
          line_count = excluded.line_count,
          summary = excluded.summary,
          mtime_ms = excluded.mtime_ms
      `);
      upsertFile.run(normPath, ext, sizeBytes, lines.length, summary, mtimeMs);

      // 2. Clear old symbols & snippets for this file
      this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(normPath);
      this.db.prepare('DELETE FROM snippets WHERE file_path = ?').run(normPath);

      // 3. Insert symbols
      const insertSymbol = this.db.prepare(`
        INSERT INTO symbols (id, file_path, name, kind, start_line, end_line, signature, docstring)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const sym of symbols) {
        insertSymbol.run(
          sym.id,
          sym.filePath,
          sym.name,
          sym.kind,
          sym.startLine,
          sym.endLine,
          sym.signature,
          sym.docstring ?? null,
        );
      }

      // 4. Insert snippets
      const insertSnippet = this.db.prepare(`
        INSERT INTO snippets (id, file_path, start_line, end_line, content, token_count, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (let i = 0; i < snippets.length; i++) {
        const snip = snippets[i]!;
        const emb = embeddings[i]!;
        insertSnippet.run(
          snip.id,
          snip.filePath,
          snip.startLine,
          snip.endLine,
          snip.content,
          snip.tokenCount,
          vectorToBuffer(emb),
        );
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Recursively indexes all code and text files within the sandbox workspace.
   */
  async indexWorkspace(sandbox: Sandbox): Promise<{ indexedFilesCount: number; symbolsCount: number }> {
    const entries = await sandbox.listDir('.', { recursive: true, maxEntries: 10000 });
    let indexedFilesCount = 0;

    for (const entry of entries) {
      if (entry.type !== 'file') continue;

      const normPath = entry.path.replace(/\\/g, '/');
      const parts = normPath.split('/');

      // Check excluded patterns
      const isExcluded = parts.some((part) =>
        this.config.excludePatterns.some((pattern) => part === pattern || part.startsWith(pattern)),
      );
      if (isExcluded) continue;

      // Ignore binary / non-text files
      const ext = path.extname(normPath).toLowerCase();
      const codeExts = [
        '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py',
        '.json', '.html', '.css', '.md', '.sql', '.yaml', '.yml',
        '.sh', '.bash', '.go', '.rs', '.java', '.c', '.cpp', '.h',
      ];
      if (!codeExts.includes(ext) && ext !== '') continue;

      try {
        const content = await sandbox.readFile(entry.path);
        if (Buffer.byteLength(content, 'utf8') > this.config.maxFileSize) continue;

        await this.indexFile(entry.path, content);
        indexedFilesCount++;
      } catch {
        // Skip unreadable files
      }
    }

    const symbolCountRow = this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as { count: number };
    return {
      indexedFilesCount,
      symbolsCount: symbolCountRow.count,
    };
  }

  /**
   * Hybrid retrieval returning the top relevant snippets for a task within a token budget.
   */
  async retrieve(query: string, options?: RetrievalOptions): Promise<RetrievedSnippet[]> {
    const maxTokens = options?.maxTokens ?? 4000;
    const maxSnippets = options?.maxSnippets ?? 10;
    const minScore = options?.minScore ?? 0.15;
    const pathPrefix = options?.pathPrefix;

    if (!query || query.trim().length === 0) {
      return [];
    }

    // 1. Generate query embedding
    let queryVec: Float32Array;
    if (this.embeddingProvider) {
      const res = await this.embeddingProvider([query]);
      queryVec = res[0]!;
    } else {
      queryVec = generateLocalEmbedding(query, this.config.embeddingDimension);
    }

    // 2. Extract query keywords for term matching
    const queryTokens = tokenizeForEmbedding(query);
    const queryTerms = queryTokens.filter((t) => t.length > 2 && !t.startsWith('<'));

    // 3. Find matching symbols
    const matchedSymbolsMap = new Map<string, string[]>(); // filePath -> symbolNames[]
    if (queryTerms.length > 0) {
      const symbolRows = this.db.prepare(`
        SELECT file_path, name, kind, signature
        FROM symbols
      `).all() as Array<{ file_path: string; name: string; kind: string; signature: string }>;

      for (const sym of symbolRows) {
        const symNameLower = sym.name.toLowerCase();
        for (const term of queryTerms) {
          if (symNameLower === term || symNameLower.includes(term)) {
            const list = matchedSymbolsMap.get(sym.file_path) ?? [];
            if (!list.includes(sym.name)) {
              list.push(sym.name);
            }
            matchedSymbolsMap.set(sym.file_path, list);
          }
        }
      }
    }

    // 4. Retrieve candidate snippets from SQLite
    let snippetQuery = 'SELECT id, file_path, start_line, end_line, content, token_count, embedding FROM snippets';
    const params: string[] = [];
    if (pathPrefix) {
      snippetQuery += ' WHERE file_path LIKE ?';
      params.push(`${pathPrefix}%`);
    }

    const snippetRows = this.db.prepare(snippetQuery).all(...params) as Array<{
      id: string;
      file_path: string;
      start_line: number;
      end_line: number;
      content: string;
      token_count: number;
      embedding: Buffer;
    }>;

    interface ScoredCandidate {
      snippet: (typeof snippetRows)[number];
      score: number;
      matchedSymbols: string[];
      reason: string;
    }

    const candidates: ScoredCandidate[] = [];

    // Query terms Set for O(1) keyword matching
    const queryTermSet = new Set(queryTerms);

    for (const row of snippetRows) {
      // 4a. Embedding semantic similarity
      const snippetVec = bufferToVector(row.embedding);
      const vectorSim = Math.max(0, cosineSimilarity(queryVec, snippetVec));

      // 4b. Keyword overlap
      const contentTokens = tokenizeForEmbedding(row.content);
      let matchCount = 0;
      for (const ct of contentTokens) {
        if (queryTermSet.has(ct)) {
          matchCount++;
        }
      }
      const keywordScore = Math.min(1.0, matchCount / Math.max(1, queryTerms.length * 2));

      // 4c. File path bonus
      const pathTokens = tokenizeForEmbedding(row.file_path);
      let pathMatches = 0;
      for (const pt of pathTokens) {
        if (queryTermSet.has(pt)) {
          pathMatches++;
        }
      }
      const pathScore = Math.min(1.0, pathMatches * 0.25);

      // 4d. Symbol match bonus
      const matchedSyms = matchedSymbolsMap.get(row.file_path) ?? [];
      const hasSymbolMatch = matchedSyms.length > 0;
      const symbolScore = hasSymbolMatch ? Math.min(0.5, matchedSyms.length * 0.25) : 0;

      // Combined hybrid score (0 to 1+)
      const combinedScore =
        0.45 * vectorSim +
        0.25 * keywordScore +
        0.15 * pathScore +
        0.15 * symbolScore;

      if (combinedScore >= minScore) {
        const reasons: string[] = [];
        if (hasSymbolMatch) reasons.push(`symbols: ${matchedSyms.slice(0, 3).join(', ')}`);
        if (pathMatches > 0) reasons.push('path match');
        if (vectorSim > 0.3) reasons.push(`semantic match (${(vectorSim * 100).toFixed(0)}%)`);
        if (matchCount > 0) reasons.push(`${matchCount} keyword hit(s)`);

        candidates.push({
          snippet: row,
          score: combinedScore,
          matchedSymbols: matchedSyms,
          reason: reasons.join(' | ') || 'relevance',
        });
      }
    }

    // 5. Sort candidates by score descending
    candidates.sort((a, b) => b.score - a.score);

    // 6. Greedy packing into token budget
    const results: RetrievedSnippet[] = [];
    let currentTokens = 0;

    for (const cand of candidates) {
      if (results.length >= maxSnippets) {
        break;
      }
      if (currentTokens + cand.snippet.token_count > maxTokens) {
        // If snippet exceeds budget, skip it
        continue;
      }

      currentTokens += cand.snippet.token_count;
      results.push({
        filePath: cand.snippet.file_path,
        startLine: cand.snippet.start_line,
        endLine: cand.snippet.end_line,
        content: cand.snippet.content,
        tokenCount: cand.snippet.token_count,
        score: Number(cand.score.toFixed(3)),
        matchedSymbols: cand.matchedSymbols,
        reason: cand.reason,
      });
    }

    return results;
  }

  /**
   * Returns list of all indexed files.
   */
  getFileTree(): IndexedFile[] {
    const rows = this.db.prepare('SELECT path, extension, size_bytes, line_count, summary, mtime_ms FROM files ORDER BY path ASC').all() as Array<{
      path: string;
      extension: string;
      size_bytes: number;
      line_count: number;
      summary: string;
      mtime_ms: number;
    }>;

    return rows.map((r) => ({
      path: r.path,
      extension: r.extension,
      sizeBytes: r.size_bytes,
      lineCount: r.line_count,
      summary: r.summary,
      mtimeMs: r.mtime_ms,
    }));
  }

  /**
   * Returns symbols, optionally filtered by file path.
   */
  getSymbols(filePath?: string): IndexedSymbol[] {
    let query = 'SELECT id, file_path, name, kind, start_line, end_line, signature, docstring FROM symbols';
    const params: string[] = [];
    if (filePath) {
      query += ' WHERE file_path = ?';
      params.push(filePath.replace(/\\/g, '/'));
    }
    query += ' ORDER BY file_path ASC, start_line ASC';

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      file_path: string;
      name: string;
      kind: string;
      start_line: number;
      end_line: number;
      signature: string;
      docstring: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      name: r.name,
      kind: r.kind as IndexedSymbol['kind'],
      startLine: r.start_line,
      endLine: r.end_line,
      signature: r.signature,
      ...(r.docstring ? { docstring: r.docstring } : {}),
    }));
  }

  /**
   * Returns the summary for a specific file path.
   */
  getFileSummary(filePath: string): string | undefined {
    const norm = filePath.replace(/\\/g, '/');
    const row = this.db.prepare('SELECT summary FROM files WHERE path = ?').get(norm) as { summary: string } | undefined;
    return row?.summary;
  }

  /**
   * Closes the SQLite database.
   */
  close(): void {
    this.db.close();
  }
}
