import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = [
  'src/gateway.mjs',
  'src/evaluator.mjs',
  'src/filter-worker.mjs',
  'solver/solve.mjs',
  'tests/challenge.mjs',
  'scripts/ctf.mjs',
  'scripts/static-check.mjs',
];

for (const relative of modules) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, relative)], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `${relative} failed node --check:\n${result.stderr}`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
assert.equal(packageJson.engines.node, '>=22');
assert.equal(packageJson.license, 'MIT');

const compose = readFileSync(resolve(root, 'compose.yaml'), 'utf8');
for (const required of [
  '127.0.0.1:${GRAPHQL_GAMBIT_PORT:-18081}:3000',
  'read_only: true',
  'no-new-privileges:true',
  'cap_drop:',
  'internal: true',
]) assert.match(compose, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true|network_mode:\s*host|volumes:/i);

const help = spawnSync(process.execPath, [resolve(root, 'scripts/ctf.mjs'), 'help'], { encoding: 'utf8', windowsHide: true });
assert.equal(help.status, 0);
for (const command of ['up', 'verify', 'status', 'flags', 'logs', 'down', 'reset', 'doctor']) {
  assert.match(help.stdout, new RegExp(`\\b${command}\\b`));
}

console.log(`static checks passed (${modules.length} JavaScript modules, package metadata, compose boundaries, launcher help)`);
