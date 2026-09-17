import ultraMegaConfig from 'eslint-config-ultra-mega';
import globals from 'globals';

export default [
  ...ultraMegaConfig,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
  },
  { ignores: ['dist/**', 'openseadragon.min.js'] },
  {
    files: ['background.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        importScripts: 'readonly',
        fetchArticImage: 'readonly',
        syncCloudflareClearance: 'readonly',
        watchCloudflareClearance: 'readonly',
      },
    },
  },
  {
    files: ['cloudflare-cookies.js'],
    languageOptions: { sourceType: 'script' },
  },
  {
    files: ['build.cjs', 'pack.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },
];
