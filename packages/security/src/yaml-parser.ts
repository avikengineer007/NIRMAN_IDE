/**
 * Zero-dependency YAML / JSON parser tailored for policy configuration files.
 * Supports mappings, sequences (- item), nested blocks, scalar types, and comments.
 */

export function parseYaml(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  // Fast-path: If it starts with '{', attempt native JSON parse
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Continue with YAML parsing
    }
  }

  const lines = text.split(/\r?\n/);
  let cursor = 0;

  function getIndent(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1]?.length ?? 0 : 0;
  }

  function cleanLine(line: string): string {
    // Strip comments not inside quotes
    let inQuotes = false;
    let quoteChar = '';
    let result = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
        result += char;
      } else if (inQuotes && char === quoteChar && line[i - 1] !== '\\') {
        inQuotes = false;
        result += char;
      } else if (!inQuotes && char === '#') {
        break; // start of comment
      } else {
        result += char;
      }
    }

    return result.trimEnd();
  }

  function parseScalar(val: string): unknown {
    const v = val.trim();
    if (v === '' || v === '~' || v === 'null') return null;
    if (v === 'true' || v === 'True') return true;
    if (v === 'false' || v === 'False') return false;
    if (!isNaN(Number(v)) && !v.startsWith('0x') && v !== '') return Number(v);

    // Unquote string
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      try {
        return JSON.parse(v);
      } catch {
        return v.slice(1, -1);
      }
    }
    return v;
  }

  function parseBlock(currentIndent: number): unknown {
    const obj: Record<string, unknown> = {};
    const arr: unknown[] = [];
    let isArray = false;
    let started = false;

    while (cursor < lines.length) {
      const rawLine = lines[cursor]!;
      const line = cleanLine(rawLine);

      if (line.trim() === '') {
        cursor++;
        continue;
      }

      const indent = getIndent(line);
      if (indent < currentIndent) {
        break; // End of current block scope
      }

      const trimmedLine = line.trim();

      // Check for array item indicator: - item
      if (trimmedLine.startsWith('-')) {
        if (!started) {
          isArray = true;
          started = true;
        }

        const itemContent = trimmedLine.slice(1).trim();
        cursor++;

        if (itemContent === '') {
          // Nested object or block in array item
          const nextIndent = cursor < lines.length ? getIndent(lines[cursor]!) : currentIndent + 2;
          arr.push(parseBlock(nextIndent));
        } else if (itemContent.includes(':')) {
          // Inline object in array item: e.g. - pattern: "..."\n  action: deny
          const colonIdx = itemContent.indexOf(':');
          const firstKey = itemContent.slice(0, colonIdx).trim();
          const firstValRaw = itemContent.slice(colonIdx + 1).trim();

          const itemObj: Record<string, unknown> = {};
          itemObj[firstKey] = parseScalar(firstValRaw);

          // Check subsequent lines with same or deeper indent belonging to this item
          const itemIndent = indent + 2;
          while (cursor < lines.length) {
            const nextRaw = lines[cursor]!;
            const nextClean = cleanLine(nextRaw);
            if (nextClean.trim() === '') {
              cursor++;
              continue;
            }
            const nextInd = getIndent(nextClean);
            if (nextInd < itemIndent || nextClean.trim().startsWith('-')) {
              break;
            }
            const nextTrim = nextClean.trim();
            const nextColon = nextTrim.indexOf(':');
            if (nextColon !== -1) {
              const k = nextTrim.slice(0, nextColon).trim();
              const v = nextTrim.slice(nextColon + 1).trim();
              itemObj[k] = parseScalar(v);
            }
            cursor++;
          }
          arr.push(itemObj);
        } else {
          arr.push(parseScalar(itemContent));
        }
        continue;
      }

      // Key-value mapping: key: value
      const colonIdx = trimmedLine.indexOf(':');
      if (colonIdx !== -1) {
        if (!started) {
          isArray = false;
          started = true;
        }

        const key = trimmedLine.slice(0, colonIdx).trim();
        const valuePart = trimmedLine.slice(colonIdx + 1).trim();
        cursor++;

        if (valuePart === '') {
          // Value is on next lines with deeper indent
          let nextIndent = currentIndent + 2;
          if (cursor < lines.length) {
            const peek = cleanLine(lines[cursor]!);
            if (peek.trim() !== '') {
              nextIndent = getIndent(peek);
            }
          }
          obj[key] = parseBlock(nextIndent);
        } else {
          obj[key] = parseScalar(valuePart);
        }
        continue;
      }

      cursor++;
    }

    return isArray ? arr : obj;
  }

  const result = parseBlock(0);
  return (typeof result === 'object' && result !== null ? result : {}) as Record<string, unknown>;
}

/**
 * Serializes a SecurityPolicy object into clean, formatted YAML.
 */
export function stringifyYaml(data: Record<string, unknown>, indent = 0): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      lines.push(`${pad}${key}: null`);
    } else if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          const itemEntries = Object.entries(item as Record<string, unknown>);
          if (itemEntries.length > 0) {
            const [firstKey, firstVal] = itemEntries[0]!;
            lines.push(`${pad}  - ${firstKey}: ${formatScalar(firstVal)}`);
            for (let i = 1; i < itemEntries.length; i++) {
              const [k, v] = itemEntries[i]!;
              lines.push(`${pad}    ${k}: ${formatScalar(v)}`);
            }
          }
        } else {
          lines.push(`${pad}  - ${formatScalar(item)}`);
        }
      }
    } else if (typeof value === 'object') {
      lines.push(`${pad}${key}:`);
      lines.push(stringifyYaml(value as Record<string, unknown>, indent + 2));
    } else {
      lines.push(`${pad}${key}: ${formatScalar(value)}`);
    }
  }

  return lines.join('\n');
}

function formatScalar(val: unknown): string {
  if (typeof val === 'string') {
    if (
      val.includes('\n') ||
      val.includes(':') ||
      val.includes('#') ||
      val.includes('"') ||
      val.includes('\\') ||
      val === ''
    ) {
      return JSON.stringify(val);
    }
    return val;
  }
  return String(val);
}
