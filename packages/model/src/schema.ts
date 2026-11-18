import type { JSONSchemaProperty, ToolParametersSchema } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function checkType(value: unknown, expectedType: JSONSchemaProperty['type']): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

function validateProperty(
  path: string,
  value: unknown,
  schema: JSONSchemaProperty,
  errors: string[],
): void {
  if (!checkType(value, schema.type)) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    errors.push(`Property "${path}" must be of type ${schema.type}, got ${actualType}`);
    return;
  }

  if (schema.enum && schema.enum.length > 0) {
    const matched = schema.enum.some((item) => item === value);
    if (!matched) {
      errors.push(
        `Property "${path}" value ${JSON.stringify(value)} is not one of allowed values: ${schema.enum.join(', ')}`,
      );
    }
  }

  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    const list = value as readonly unknown[];
    for (let i = 0; i < list.length; i++) {
      const item: unknown = list[i];
      validateProperty(`${path}[${i}]`, item, schema.items, errors);
    }
  }

  if (
    schema.type === 'object' &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const record = value as Record<string, unknown>;
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in record) || record[req] === undefined) {
          errors.push(`Missing required nested property "${path}.${req}"`);
        }
      }
    }
    if (schema.properties) {
      for (const [propKey, propVal] of Object.entries(record)) {
        const propSchema = schema.properties[propKey];
        if (propSchema) {
          validateProperty(`${path}.${propKey}`, propVal, propSchema, errors);
        }
      }
    }
  }
}

/**
 * Validates data against a tool's parameter schema.
 */
export function validateSchema(data: unknown, schema: ToolParametersSchema): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      valid: false,
      errors: ['Tool arguments must be a JSON object'],
    };
  }

  const record = data as Record<string, unknown>;

  // Check required fields
  if (schema.required) {
    for (const reqKey of schema.required) {
      if (!(reqKey in record) || record[reqKey] === undefined) {
        errors.push(`Missing required argument "${reqKey}"`);
      }
    }
  }

  // Check properties
  if (schema.properties) {
    for (const [key, value] of Object.entries(record)) {
      const propSchema = schema.properties[key];
      if (propSchema) {
        validateProperty(key, value, propSchema, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`Unexpected argument "${key}" is not permitted`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
