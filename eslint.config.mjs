// The strict TypeScript lint config of the standard (Q14): typescript-eslint's
// strictTypeChecked and stylisticTypeChecked with type information. A repository copies this
// file and adds its own ignores.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // The config itself is plain JavaScript outside the TypeScript project.
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
