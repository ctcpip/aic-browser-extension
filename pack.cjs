const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { build } = require('./build.cjs');

try {
  fs.rmSync(path.join(__dirname, 'aic-browser-extension-enhanced.zip'), { force: true });
  build();

  for (const browser of ['chrome', 'firefox']) {
    const filename = path.join(__dirname, `aic-browser-extension-enhanced-${browser}.zip`);
    execSync(`rm -f "${filename}" && zip -r "${filename}" .`, {
      cwd: path.join(__dirname, 'dist', browser),
      stdio: 'inherit',
    });
    console.log(`✅ Created ${path.basename(filename)}`);
  }
}
catch (err) {
  console.error('❌ Failed to create zip:', err.message);
  process.exit(1);
}
