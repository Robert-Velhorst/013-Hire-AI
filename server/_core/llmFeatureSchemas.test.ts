import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { compileLlmSchema } from "./llmSchema";

// Inspect only literal schema data through the TypeScript parser, never execute
// source expressions or depend on the provider mocks in feature-router tests.
function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map(property => {
      if (!ts.isPropertyAssignment(property) ||
          (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) {
        throw new Error("A dynamic AI schema requires an explicit runtime compatibility test");
      }
      return [property.name.text, literal(property.initializer)];
    }));
  }
  throw new Error("A non-literal AI schema requires an explicit runtime compatibility test");
}

const files = ["aiMatching", "careerIntelligence", "diversitySupport", "socialConnections", "resumeParser", "applicationFeatures"];
for (const name of files) {
  const source = ts.createSourceFile(`${name}.ts`, readFileSync(`server/${name}.ts`, "utf8"), ts.ScriptTarget.Latest, true);
  const schemas: Array<{ name: string; schema: Record<string, unknown> }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "json_schema") {
      schemas.push(literal(node.initializer) as { name: string; schema: Record<string, unknown> });
    } else ts.forEachChild(node, visit);
  };
  visit(source);

  describe(`declared AI schemas in ${name}`, () => {
    it("covers the feature's schema declarations", () => expect(schemas.length).toBeGreaterThan(0));
    for (const schema of schemas) {
      it(`compiles ${schema.name} without relaxing its constraints`, () => {
        expect(() => compileLlmSchema(schema.schema)).not.toThrow();
      });
    }
  });
}
