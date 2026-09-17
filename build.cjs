const fs = require('fs');
const path = require('path');

const root = __dirname;
const outputRoot = path.join(root, 'dist');
const packageJSON = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const commonFiles = packageJSON.files.filter(file => file !== 'manifest.json');
const targets = {
  chrome: 'manifest.json',
  firefox: 'manifest.firefox.json',
};

function build() {
  fs.rmSync(outputRoot, { recursive: true, force: true });

  for (const [target, manifest] of Object.entries(targets)) {
    const output = path.join(outputRoot, target);
    fs.mkdirSync(output, { recursive: true });

    for (const file of commonFiles) {
      fs.cpSync(path.join(root, file), path.join(output, file), { recursive: true });
    }

    fs.copyFileSync(path.join(root, manifest), path.join(output, 'manifest.json'));
  }

  console.log('Built dist/chrome and dist/firefox');
}

if (require.main === module) {
  build();
}

module.exports = { build };
