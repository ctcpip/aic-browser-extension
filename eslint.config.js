import ultraMegaConfig from 'eslint-config-ultra-mega';

export default [
  ...ultraMegaConfig,
  {
    languageOptions: {
      globals: {
        browser: 'readonly',
        chrome: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
        window: 'readonly',
        XMLHttpRequest: 'readonly',
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
    files: ['build.cjs', 'pack.cjs', 'version.cjs'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
  },
];
