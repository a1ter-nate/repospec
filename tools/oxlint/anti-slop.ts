import { definePlugin, defineRule } from "@oxlint/plugins";

const noChainedTypeAssertions = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow chained type assertions such as `x as unknown as T`.",
    },
  },
  create(context) {
    return {
      TSAsExpression(node) {
        if (node.expression && node.expression.type === "TSAsExpression") {
          context.report({
            node,
            message:
              "Avoid chained type assertions (`as ... as ...`). Narrow with a type guard or schema parse instead.",
          });
        }
      },
    };
  },
});

const noUnsafeDictionaryType = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow `Record<string, any>` dictionary types.",
    },
  },
  create(context) {
    return {
      TSTypeReference(node) {
        if (
          node.typeName &&
          node.typeName.type === "Identifier" &&
          node.typeName.name === "Record" &&
          node.typeArguments &&
          node.typeArguments.params.length === 2
        ) {
          const valType = node.typeArguments.params[1];
          if (valType && valType.type === "TSAnyKeyword") {
            context.report({
              node,
              message: "Avoid `Record<string, any>`. Use `Record<string, unknown>` or a concrete interface.",
            });
          }
        }
      },
    };
  },
});

const noReflectGet = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow Reflect.get." },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee &&
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Reflect" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "get"
        ) {
          context.report({ node, message: "Avoid `Reflect.get`. Use typed property access or a Map." });
        }
      },
    };
  },
});

const noReflectApply = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow Reflect.apply." },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee &&
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Reflect" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "apply"
        ) {
          context.report({ node, message: "Avoid `Reflect.apply`. Call the typed function directly." });
        }
      },
    };
  },
});

const noModuleMocking = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow module mocking calls (`vi.mock`, `jest.mock`, `mock.module`)." },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee &&
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.property.type === "Identifier"
        ) {
          const obj = node.callee.object.name;
          const prop = node.callee.property.name;
          if (((obj === "vi" || obj === "jest") && prop === "mock") || (obj === "mock" && prop === "module")) {
            context.report({
              node,
              message: "Avoid module mocking. Pass dependencies explicitly or test against real implementations.",
            });
          }
        }
      },
    };
  },
});

const noConditionalEmptyObjectSpread = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow `...(cond ? obj : {})` spread boilerplate." },
  },
  create(context) {
    return {
      SpreadElement(node) {
        if (node.argument && node.argument.type === "ConditionalExpression") {
          const cons = node.argument.consequent;
          const alt = node.argument.alternate;
          const isEmptyObj = (n: { type: string; properties?: unknown[] }): boolean =>
            n.type === "ObjectExpression" && Array.isArray(n.properties) && n.properties.length === 0;
          if (isEmptyObj(cons) || isEmptyObj(alt)) {
            context.report({
              node,
              message: "Avoid conditional empty-object spread `...(cond ? x : {})`. Assign explicitly or pass undefined.",
            });
          }
        }
      },
    };
  },
});

export default definePlugin({
  meta: {
    name: "anti-slop",
  },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertions,
    "no-unsafe-dictionary-type": noUnsafeDictionaryType,
    "no-reflect-get": noReflectGet,
    "no-reflect-apply": noReflectApply,
    "no-module-mocking": noModuleMocking,
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpread,
  },
});
