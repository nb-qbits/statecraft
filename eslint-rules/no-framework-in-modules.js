const FORBIDDEN_PACKAGES = [
  "fastify",
  "express",
  "koa",
  "hapi",
  "drizzle-orm",
  "pg",
  "postgres",
  "@aws-sdk",
  "pino",
  "ioredis",
  "bullmq",
  "pg-boss",
  "graphile-worker",
];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow framework/infrastructure imports inside src/modules/",
    },
    messages: {
      forbidden:
        'Framework import "{{source}}" is not allowed inside src/modules/. Domain code must not depend on infrastructure.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const inModules =
      filename.includes("/src/modules/") ||
      filename.includes("\\src\\modules\\");

    if (!inModules) return {};

    function check(node) {
      const source = node.source?.value;
      if (typeof source !== "string") return;

      const isForbidden = FORBIDDEN_PACKAGES.some(
        (pkg) => source === pkg || source.startsWith(pkg + "/"),
      );
      if (isForbidden) {
        context.report({ node, messageId: "forbidden", data: { source } });
      }
    }

    return {
      ImportDeclaration: check,
      ImportExpression: check,
    };
  },
};
