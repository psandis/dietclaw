import { isBuiltin } from "node:module";
import { type Argument, parseSync, Visitor } from "oxc-parser";

// Module specifiers a JS/TS file depends on:
//   import x from "a"            export { y } from "b"
//   import "c"                   import("d")
//   require("e")                 import f = require("f")   (TypeScript)
// Only statically known strings count. require(variable) cannot be resolved.
export function collectModuleSpecifiers(filename: string, source: string): Set<string> {
  const { module, program } = parseSync(filename, source);
  const specifiers = new Set<string>();

  for (const entry of module.staticImports) {
    specifiers.add(entry.moduleRequest.value);
  }

  for (const statement of module.staticExports) {
    for (const entry of statement.entries) {
      if (entry.moduleRequest) specifiers.add(entry.moduleRequest.value);
    }
  }

  const addStatic = (node: Argument | undefined) => {
    const value = node ? staticString(node) : null;
    if (value !== null) specifiers.add(value);
  };

  new Visitor({
    ImportExpression: (node) => addStatic(node.source),
    CallExpression: (node) => {
      if (node.callee.type === "Identifier" && node.callee.name === "require") {
        addStatic(node.arguments[0]);
      }
    },
    TSExternalModuleReference: (node) => specifiers.add(node.expression.value),
  }).visit(program);

  return specifiers;
}

// "lodash/get" -> "lodash", "@scope/pkg/sub" -> "@scope/pkg".
// null for relative and absolute paths, package subpath imports (#internal),
// URL and protocol specifiers (node:fs, data:, C:\), and Node.js built-ins.
export function packageNameOf(specifier: string): string | null {
  if (/^[./#]/.test(specifier) || specifier.includes(":") || isBuiltin(specifier)) return null;

  const [first, second] = specifier.split("/");
  if (first.startsWith("@")) return second ? `${first}/${second}` : null;
  return first || null;
}

function staticString(node: Argument): string | null {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}
