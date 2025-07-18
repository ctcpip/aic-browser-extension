const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PACKAGE_JSON_PATH = path.resolve(__dirname, 'package.json');
const ZIP_FILENAME = 'chrome-aic-browser-extension-enhanced.zip';

const packageJSON = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const files = packageJSON.files;

if (fs.existsSync(ZIP_FILENAME)) {
  fs.unlinkSync(ZIP_FILENAME);
}

const quotedPaths = files.map(f => `"${f}"`).join(' ');
const command = `zip -r "${ZIP_FILENAME}" ${quotedPaths}`;

try {
  execSync(command, { stdio: 'inherit' });
  console.log(`✅ Created ${ZIP_FILENAME}`);
}
catch (err) {
  console.error('❌ Failed to create zip:', err.message);
  process.exit(1);
}
