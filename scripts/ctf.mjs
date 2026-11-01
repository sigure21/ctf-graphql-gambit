#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = resolve(ROOT, '.runtime');
const CONFIG_PATH = resolve(RUNTIME_DIR, 'config.json');
const COMPOSE_FILE = resolve(ROOT, 'compose.yaml');
const PROJECT_NAME = 'ctf-graphql-gambit-standalone';
const DEFAULT_PORT = 18081;
const command = process.argv[2] ?? 'help';
const args = process.argv.slice(3);

const HELP = `GraphQL Gambit launcher

Usage:
  node scripts/ctf.mjs up [--port 18081]  Generate secrets, build, start, wait, verify
  node scripts/ctf.mjs verify             Run the live regression test
  node scripts/ctf.mjs status             Show container status
  node scripts/ctf.mjs flags              Print the organizer flag
  node scripts/ctf.mjs logs [--follow]    Show service logs
  node scripts/ctf.mjs down               Stop containers; preserve runtime secrets
  node scripts/ctf.mjs reset [--port N]   Stop, rotate secrets/flag, and start cleanly
  node scripts/ctf.mjs doctor             Check Node, Docker, Compose, config, and daemon
  node scripts/ctf.mjs help               Show this help

Runtime state is stored in ignored .runtime/config.json.
Only localhost is published.`;

function fail(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

function optionValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (index + 1 >= args.length || args[index + 1].startsWith('--')) fail(`${name} requires a value`);
  return args[index + 1];
}

function requestedPort(fallback = DEFAULT_PORT) {
  const raw = optionValue('--port');
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || String(value) !== raw || value < 1024 || value > 65535) {
    fail('--port must be an integer from 1024 through 65535');
  }
  return value;
}

function validateRuntime(value) {
  if (!value || typeof value !== 'object') throw new Error('runtime config is not an object');
  if (!/^flag\{[A-Za-z0-9_-]{20,120}\}$/.test(value.flag ?? '')) throw new Error('runtime flag is invalid');
  if (!/^[a-f0-9]{64}$/.test(value.proxySecret ?? '')) throw new Error('runtime proxy secret is invalid');
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error('runtime port is invalid');
  return value;
}

function loadRuntime({ create = false, port } = {}) {
  if (existsSync(CONFIG_PATH)) {
    try {
      const current = validateRuntime(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
      if (port !== undefined && port !== current.port) {
        current.port = port;
        writeRuntime(current);
      }
      return current;
    } catch (error) {
      fail(`cannot read ${CONFIG_PATH}: ${error.message}; run reset to replace it`);
    }
  }
  if (!create) fail('runtime state does not exist; run `node scripts/ctf.mjs up` first');
  const value = {
    version: 1,
    createdAt: new Date().toISOString(),
    port: port ?? DEFAULT_PORT,
    flag: `flag{${randomBytes(24).toString('base64url')}}`,
    proxySecret: randomBytes(32).toString('hex'),
  };
  writeRuntime(value);
  return value;
}

function writeRuntime(value) {
  mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function removeRuntimeConfig() {
  const candidate = resolve(CONFIG_PATH);
  const relation = relative(RUNTIME_DIR, candidate);
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
    fail('refusing to remove a runtime path outside .runtime');
  }
  rmSync(candidate, { force: true });
}

function composeEnv(runtime) {
  return {
    ...process.env,
    FLAG: runtime.flag,
    PROXY_SECRET: runtime.proxySecret,
    GRAPHQL_GAMBIT_PORT: String(runtime.port),
  };
}

function run(program, programArgs, options = {}) {
  const result = spawnSync(program, programArgs, {
    cwd: ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    if (!options.allowFailure) fail(`could not run ${program}: ${result.error.message}`);
    return result;
  }
  if (result.status !== 0 && !options.allowFailure) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    fail(`${program} exited with status ${result.status}`, result.status ?? 1);
  }
  return result;
}

function compose(runtime, composeArgs, options = {}) {
  return run('docker', ['compose', '-p', PROJECT_NAME, '-f', COMPOSE_FILE, ...composeArgs], {
    ...options,
    env: composeEnv(runtime),
  });
}

async function waitForHealth(runtime, timeoutMs = 120_000) {
  const url = `http://127.0.0.1:${runtime.port}/healthz`;
  const deadline = Date.now() + timeoutMs;
  let last = 'not reachable';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) {
        const body = await response.json();
        if (body?.service === 'graphql-gateway') return;
        last = `unexpected health body: ${JSON.stringify(body)}`;
      } else {
        last = `HTTP ${response.status}`;
      }
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
  }
  compose(runtime, ['logs', '--tail', '80'], { allowFailure: true });
  fail(`healthcheck timed out for ${url}: ${last}`);
}

function checkNode() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 22) fail(`Node.js 22 or newer is required; found ${process.version}`);
  return process.version;
}

function dockerVersion() {
  const result = run('docker', ['--version'], { capture: true, allowFailure: true });
  if (result.status !== 0) fail('Docker CLI was not found');
  return result.stdout.trim();
}

function composeVersion() {
  const result = run('docker', ['compose', 'version'], { capture: true, allowFailure: true });
  if (result.status !== 0) fail('Docker Compose v2 was not found');
  return result.stdout.trim();
}

async function verify(runtime) {
  await waitForHealth(runtime, 30_000);
  run(process.execPath, ['tests/challenge.mjs'], {
    env: { ...process.env, CHALLENGE_URL: `http://127.0.0.1:${runtime.port}` },
  });
}

async function up({ rotate = false } = {}) {
  checkNode();
  dockerVersion();
  composeVersion();
  const port = optionValue('--port') === undefined ? undefined : requestedPort(DEFAULT_PORT);
  if (rotate && existsSync(CONFIG_PATH)) {
    removeRuntimeConfig();
  }
  const runtime = loadRuntime({ create: true, port });
  compose(runtime, ['config', '--quiet']);
  compose(runtime, ['up', '-d', '--build', '--remove-orphans']);
  await waitForHealth(runtime);
  await verify(runtime);
  console.log(`ready: http://127.0.0.1:${runtime.port}`);
  console.log('organizer flag: node scripts/ctf.mjs flags');
}

async function doctor() {
  const node = checkNode();
  const docker = dockerVersion();
  const composeText = composeVersion();
  const runtime = existsSync(CONFIG_PATH)
    ? loadRuntime()
    : { flag: 'flag{doctor_config_only_000000}', proxySecret: '0'.repeat(64), port: requestedPort(DEFAULT_PORT) };
  compose(runtime, ['config', '--quiet']);
  const daemon = run('docker', ['info', '--format', '{{.ServerVersion}}'], { capture: true, allowFailure: true });
  console.log(`Node: ${node}`);
  console.log(`Docker CLI: ${docker}`);
  console.log(`Compose: ${composeText}`);
  console.log(`Compose config: valid`);
  if (daemon.status === 0) console.log(`Docker daemon: ${daemon.stdout.trim()}`);
  else fail('Docker daemon is not reachable; start Docker Desktop or the Docker service');
}

switch (command) {
  case 'up':
    await up();
    break;
  case 'verify':
    await verify(loadRuntime());
    break;
  case 'status': {
    const runtime = loadRuntime();
    compose(runtime, ['ps']);
    break;
  }
  case 'flags': {
    const runtime = loadRuntime();
    console.log(runtime.flag);
    break;
  }
  case 'logs': {
    const runtime = loadRuntime();
    compose(runtime, ['logs', '--tail', '200', ...(args.includes('--follow') ? ['--follow'] : [])]);
    break;
  }
  case 'down': {
    const runtime = loadRuntime();
    compose(runtime, ['down', '--remove-orphans']);
    break;
  }
  case 'reset': {
    if (existsSync(CONFIG_PATH)) {
      const runtime = loadRuntime();
      compose(runtime, ['down', '--remove-orphans'], { allowFailure: true });
    }
    await up({ rotate: true });
    break;
  }
  case 'doctor':
    await doctor();
    break;
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;
  default:
    console.error(HELP);
    fail(`unknown command: ${command}`, 2);
}
