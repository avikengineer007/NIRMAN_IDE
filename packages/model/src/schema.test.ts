import { describe, expect, it } from 'vitest';
import { validateSchema } from './schema.js';
import type { ToolParametersSchema } from './types.js';

describe('schema validation', () => {
  const fileToolSchema: ToolParametersSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path' },
      maxLines: { type: 'integer', description: 'Maximum lines to read' },
      mode: {
        type: 'string',
        enum: ['exact', 'regex'],
        description: 'Search mode',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of tags',
      },
    },
    required: ['path'],
    additionalProperties: false,
  };

  it('passes on valid arguments', () => {
    const data = {
      path: 'src/main.ts',
      maxLines: 50,
      mode: 'exact',
      tags: ['typescript', 'core'],
    };

    const result = validateSchema(data, fileToolSchema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects non-object argument values', () => {
    const result = validateSchema('not an object', fileToolSchema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('must be a JSON object');
  });

  it('fails when required property is missing', () => {
    const data = { maxLines: 50 };
    const result = validateSchema(data, fileToolSchema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required argument "path"');
  });

  it('fails when property type is wrong', () => {
    const data = { path: 12345 };
    const result = validateSchema(data, fileToolSchema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('must be of type string, got number');
  });

  it('fails when integer expected but float received', () => {
    const data = { path: 'a.txt', maxLines: 12.5 };
    const result = validateSchema(data, fileToolSchema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('must be of type integer');
  });

  it('fails when enum constraint violated', () => {
    const data = { path: 'a.txt', mode: 'fuzzy' };
    const result = validateSchema(data, fileToolSchema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not one of allowed values');
  });

  it('fails when unexpected argument is provided with additionalProperties false', () => {
    const data = { path: 'a.txt', extraField: true };
    const result = validateSchema(data, fileToolSchema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unexpected argument "extraField"');
  });
});
