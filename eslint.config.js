import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // Node.js builtins
            ['^node:'],
            // External packages
            ['^@?\\w'],
            // Internal path aliases
            ['^@/'],
            // Relative imports
            ['^\\.\\.'],
            ['^\\.'],
            // Side effect imports
            ['^\\u0000']
          ]
        }
      ],
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    ignores: [
      '**/dist/**', 
      '**/node_modules/**', 
      '**/public/**', 
      'eslint.config.js', 
      'postcss.config.js', 
      'tailwind.config.js',
      '**/storage/**',
      '**/data/**'
    ]
  }
);
