import Ajv from "ajv";

export type LlmSchemaValidator = (value: unknown) => boolean;

const ajv = new Ajv({ strict: true, addUsedSchema: false, ownProperties: true, logger: false });
const validators = new Map<string, LlmSchemaValidator>();
const MAX_CACHED_SCHEMAS = 64;
const MAX_SCHEMA_BYTES = 64 * 1024;

/** Only server-authored schemas belong here; this never loads remote references. */
export function compileLlmSchema(schema: Record<string, unknown>): LlmSchemaValidator {
  let key: string;
  try {
    if (!schema || typeof schema !== "object" || Array.isArray(schema) || schema.$async) throw new Error();
    key = JSON.stringify(schema);
    if (Buffer.byteLength(key, "utf8") > MAX_SCHEMA_BYTES) throw new Error();
  } catch {
    throw new Error("LLM schema is invalid or exceeds the size limit");
  }
  const cached = validators.get(key);
  if (cached) {
    validators.delete(key);
    validators.set(key, cached);
    return cached;
  }

  const copy = JSON.parse(key);
  let compiled;
  try {
    compiled = ajv.compile(copy);
    if ("$async" in compiled && compiled.$async) throw new Error();
  } catch {
    throw new Error("LLM schema is invalid or unsupported");
  } finally {
    // Ajv also caches by object identity. Keep only our bounded content-keyed
    // cache, since callers construct fresh but equivalent schemas on each call.
    ajv.removeSchema(copy);
  }
  const validate: LlmSchemaValidator = value => {
    try {
      return compiled(value) === true;
    } finally {
      compiled.errors = null;
    }
  };
  if (validators.size >= MAX_CACHED_SCHEMAS) {
    const oldest = validators.keys().next().value;
    if (oldest !== undefined) validators.delete(oldest);
  }
  validators.set(key, validate);
  return validate;
}
