import ultraMegaConfig from 'eslint-config-ultra-mega';

export default [
  ...ultraMegaConfig,
  { ignores: ['openseadragon.min.js'] },
];
