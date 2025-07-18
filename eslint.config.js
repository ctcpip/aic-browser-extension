import ultraMegaConfig from 'eslint-config-ultra-mega';
import globals from 'globals';

export default [
  ...ultraMegaConfig,
  { languageOptions: { globals: { ...globals.browser } } },
  { ignores: ['openseadragon.min.js'] },
  {
    files: ['pack.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },
];
