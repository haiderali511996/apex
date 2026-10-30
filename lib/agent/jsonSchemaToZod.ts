import { z } from "zod";

/**
 * Bridges the agent's tool definitions into the Claude Agent SDK.
 *
 * The connectors declare their inputs as JSON Schema, because that is what the
 * Messages API takes. The Agent SDK's `tool()` wants a Zod raw shape instead.
 * Rather than maintain both by hand — two descriptions of the same argument,
 * drifting apart the first time one is edited — this converts one into the
 * other at startup, so `tools.ts` stays the single source of truth.
 *
 * It covers the shapes the tool definitions actually use: strings, numbers,
 * booleans, string enums, arrays, nested objects, and open string maps.
 */

export type JsonSchema = {
  type?: string;
  description?: string;
  enum?: readonly string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: JsonSchema | boolean;
};

function toZod(schema: JsonSchema): z.ZodTypeAny {
  if (schema.enum?.length) {
    return z.enum([...schema.enum] as [string, ...string[]]);
  }
  switch (schema.type) {
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(schema.items ? toZod(schema.items) : z.string());
    case "object": {
      if (schema.properties) return z.object(toShape(schema));
      // An open map, e.g. the CRM's column-name -> value fields.
      const values =
        typeof schema.additionalProperties === "object"
          ? toZod(schema.additionalProperties)
          : z.string();
      return z.record(z.string(), values);
    }
    default:
      return z.string();
  }
}

/** The `properties` of an object schema, as a Zod raw shape. */
export function toShape(schema: JsonSchema): z.ZodRawShape {
  const required = new Set(schema.required ?? []);
  // Built as a plain record: Zod 4's ZodRawShape is readonly, so it can't be
  // filled in place.
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    let field = toZod(property);
    // Descriptions are how the model learns what an argument means, so they
    // have to survive the conversion.
    if (property.description) field = field.describe(property.description);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return shape as z.ZodRawShape;
}
