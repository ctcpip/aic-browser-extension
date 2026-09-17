const fs = require('fs');
const path = require('path');

const root = __dirname;
const files = ['package.json', 'manifest.json', 'manifest.firefox.json'];
const requestedVersion = process.argv[2];
const packagePath = path.join(root, 'package.json');
const packageJSON = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

function bumpVersion(version, release) {
  const parts = version.split('.').map(Number);

  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Cannot bump invalid version: ${version}`);
  }

  const releaseIndex = { major: 0, minor: 1, patch: 2 }[release];
  parts[releaseIndex] += 1;

  for (let index = releaseIndex + 1; index < parts.length; index += 1) {
    parts[index] = 0;
  }

  return parts.join('.');
}

function updateVersion(filename, version) {
  const filePath = path.join(root, filename);
  const contents = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(contents);

  if (typeof json.version !== 'string') {
    throw new Error(`${filename} does not have a version`);
  }

  const updated = contents.replace(
    /("version"\s*:\s*")[^"]+(")/,
    `$1${version}$2`,
  );

  fs.writeFileSync(filePath, updated);
}

try {
  const version = ['major', 'minor', 'patch'].includes(requestedVersion)
    ? bumpVersion(packageJSON.version, requestedVersion)
    : requestedVersion || packageJSON.version;

  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }

  for (const filename of files) {
    updateVersion(filename, version);
  }

  console.log(`Updated version to ${version}`);
}
catch (error) {
  console.error(error.message);
  process.exit(1);
}
