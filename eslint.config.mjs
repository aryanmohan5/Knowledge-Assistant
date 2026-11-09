import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const bypassRestriction = {
  name: "@/lib/db/bypass",
  message: "Tenant bypass is only allowed in src/lib/db/system.ts.",
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { paths: [bypassRestriction], patterns: [{ group: ["**/db/bypass"], message: bypassRestriction.message }] },
      ],
    },
  },
  {
    // Route handlers must go through requireTenant()/repos(), never raw models.
    files: ["src/app/**/*.ts", "src/app/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            bypassRestriction,
            { name: "mongoose", message: "Use repos(ctx) from @/lib/tenant/repos.", allowTypeImports: true },
            { name: "@/lib/db/system", message: "Cross-tenant lookups are not allowed in route handlers." },
          ],
          patterns: [
            {
              group: ["@/models", "@/models/*", "**/models/*"],
              message: "Use repos(ctx) from @/lib/tenant/repos instead of importing models.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/db/system.ts", "src/lib/db/plugins/tenantScope.ts"],
    rules: { "@typescript-eslint/no-restricted-imports": "off" },
  },
];

export default eslintConfig;
