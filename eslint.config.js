import tseslint from "typescript-eslint";
import noFrameworkInModules from "./eslint-rules/no-framework-in-modules.js";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "sidecar/", "eslint-rules/"],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      "local-rules": {
        rules: {
          "no-framework-in-modules": noFrameworkInModules,
        },
      },
    },
    rules: {
      "local-rules/no-framework-in-modules": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
