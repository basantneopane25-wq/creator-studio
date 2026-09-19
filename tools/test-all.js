/* Runs every test suite.   node tools/test-all.js   (needs Node 18+, no installs) */
const { spawnSync } = require('child_process');
const path = require('path');
const suites = ['test-higgs.js', 'test-recipes.js', 'test-postkit.js', 'test-factory.js', 'test-proxy.mjs'];
let failed = 0;
for (const s of suites) {
  console.log('\n=== ' + s + ' ===');
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) FAILED` : '\nAll suites passed');
process.exitCode = failed ? 1 : 0;
