const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

execFileSync(
  process.execPath,
  ['--import', 'tsx', resolve(__dirname, 'lexara-pantheon-semantic-routing.test.ts')],
  { stdio: 'inherit' },
);