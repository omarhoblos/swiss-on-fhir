import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';
import svelteConfig from './svelte.config.js';

/**
 * Swiss has exactly one configuration story: `.env` is rendered into
 * static/config/env.json at container start, the app fetches it at boot
 * (src/lib/config/runtime.ts), and live in-app edits layer on top.
 *
 * Vite's build-time env and SvelteKit's $env modules are deliberately NOT
 * part of that story. `$env/dynamic/*` is backed by a server runtime and
 * resolves to an empty object under adapter-static with ssr:false, so using
 * it would fail silently. This rule is what stops a second, competing config
 * mechanism from growing back later.
 */
const noCompetingConfigSources = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: '$env/dynamic/public',
          message:
            'Swiss config comes from static/config/env.json. See src/lib/config/runtime.ts. $env/dynamic/* does not work under adapter-static.'
        },
        {
          name: '$env/dynamic/private',
          message:
            'Swiss config comes from static/config/env.json. See src/lib/config/runtime.ts. $env/dynamic/* does not work under adapter-static.'
        },
        {
          name: '$env/static/private',
          message:
            'Deployer-facing config must be runtime-loaded, not baked at build time. See src/lib/config/runtime.ts.'
        }
      ]
    }
  ]
};

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      ...noCompetingConfigSources,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      // Swiss is served at the origin root only (kit.paths.base is a
      // build-time constant, so a runtime-configurable base path is
      // impossible and we deliberately do not support one). Plain hrefs are
      // therefore correct and resolve() would be noise.
      'svelte/no-navigation-without-resolve': 'off'
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: ts.parser,
        projectService: true,
        extraFileExtensions: ['.svelte'],
        svelteConfig
      }
    }
  },
  {
    ignores: [
      '.svelte-kit/',
      'build/',
      'node_modules/',
      'static/',
      'playwright-report/',
      'test-results/'
    ]
  }
);
