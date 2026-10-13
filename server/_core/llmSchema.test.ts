import { describe, expect, it } from "vitest";
import { compileLlmSchema } from "./llmSchema";

describe("bounded AI schema compilation", () => {
  it("reuses compiled validation for equivalent freshly constructed schemas", () => {
    const schema = { title: "reuse", type: "object", properties: { score: { type: "integer" } }, required: ["score"] };
    const first = compileLlmSchema(schema);
    expect(compileLlmSchema(JSON.parse(JSON.stringify(schema)))).toBe(first);
    expect(first({ score: 10 })).toBe(true);
    expect(first({ score: "10" })).toBe(false);
  });

  it("evicts old compiled functions instead of retaining an unbounded schema cache", () => {
    const firstSchema = { title: "oldest", type: "string" };
    const first = compileLlmSchema(firstSchema);
    for (let index = 0; index < 64; index++) {
      compileLlmSchema({ title: `bounded-${index}`, type: "string" });
    }
    expect(compileLlmSchema(firstSchema)).not.toBe(first);
    expect(first("retained caller reference still works")).toBe(true);
  });

  it("does not use stale validation after a caller mutates a schema object", () => {
    const schema = { title: "mutable", type: "string" };
    const original = compileLlmSchema(schema);
    schema.type = "number";
    const changed = compileLlmSchema(schema);
    expect(changed).not.toBe(original);
    expect(original("value")).toBe(true);
    expect(changed("value")).toBe(false);
    expect(changed(1)).toBe(true);
  });

  it("keeps recently reused validators when the cache reaches capacity", () => {
    const schema = { title: "recently-used", type: "string" };
    const original = compileLlmSchema(schema);
    for (let index = 0; index < 63; index++) {
      compileLlmSchema({ title: `lru-${index}`, type: "string" });
    }
    expect(compileLlmSchema(schema)).toBe(original);
    compileLlmSchema({ title: "new-entry", type: "string" });
    expect(compileLlmSchema(schema)).toBe(original);
  });

  it("does not treat inherited properties as candidate evidence", () => {
    const validate = compileLlmSchema({ type: "object", properties: { score: { type: "number" } }, required: ["score"] });
    expect(validate(Object.create({ score: 80 }))).toBe(false);
  });

  it("does not coerce types, insert defaults or remove unexpected properties", () => {
    const validate = compileLlmSchema({ type: "object", properties: { score: { type: "number", default: 10 } },
      required: ["score"], additionalProperties: false });
    const value = { score: "10", extra: "preserve" };
    expect(validate(value)).toBe(false);
    expect(value).toEqual({ score: "10", extra: "preserve" });
    const missing = {};
    expect(validate(missing)).toBe(false);
    expect(missing).toEqual({});
  });

  it("rejects oversized and cyclic schemas with bounded errors", () => {
    expect(() => compileLlmSchema({ type: "string", description: "x".repeat(65536) })).toThrow(/LLM schema/);
    const cyclic: Record<string, unknown> = { type: "object" };
    cyclic.properties = { self: cyclic };
    expect(() => compileLlmSchema(cyclic)).toThrow(/LLM schema/);
  });

  it("keeps schemas with identical ids isolated by their actual content", () => {
    const first = compileLlmSchema({ $id: "urn:hire-ai:test", type: "string" });
    const second = compileLlmSchema({ $id: "urn:hire-ai:test", type: "number" });
    expect(first("value")).toBe(true);
    expect(second("value")).toBe(false);
  });
});
