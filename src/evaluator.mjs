import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Worker } from 'node:worker_threads';

const HOST = process.env.EVALUATOR_HOST ?? '127.0.0.1';
const PORT = numberFromEnv('EVALUATOR_PORT', 4200);
const FLAG = process.env.FLAG ?? '';
const PROXY_SECRET = process.env.PROXY_SECRET ?? '';
const MAX_BODY_BYTES = 16 * 1024;
const WORKER_URL = new URL('./filter-worker.mjs', import.meta.url);

if (!/^flag\{[^\r\n]{4,160}\}$/i.test(FLAG)) throw new Error('FLAG must use flag{...} format');
if (!/^[a-f0-9]{64}$/i.test(PROXY_SECRET)) throw new Error('PROXY_SECRET must be 64 hexadecimal characters');

const RECORDS = Object.freeze([
  { taskGroupId: 'grp-firefly-1042', name: 'Firefly Linux build', task: { state: 'running', owner: 'buildbot', kind: 'build' } },
  { taskGroupId: 'grp-gecko-2048', name: 'Gecko integration tests', task: { state: 'completed', owner: 'ci-bot', kind: 'test' } },
  { taskGroupId: 'grp-nightly-4096', name: 'Nightly artifact signing', task: { state: 'pending', owner: 'release-bot', kind: 'release' } },
]);

function numberFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('too large');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid json');
  return value;
}

function trustedProxy(req) {
  const supplied = String(req.headers['x-proxy-secret'] ?? '');
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied.toLowerCase()), Buffer.from(PROXY_SECRET.toLowerCase()));
}

function graphqlError(message, code = 'BAD_USER_INPUT') {
  return { errors: [{ message, extensions: { code } }], data: { taskGroups: null } };
}

function evaluateFilter(filter) {
  return new Promise((resolvePromise) => {
    const worker = new Worker(WORKER_URL, {
      workerData: { filter, records: RECORDS },
      env: { FLAG },
      resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 1 },
    });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    };
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {});
      finish({ ok: false, error: 'filter evaluation timed out' });
    }, 750);
    worker.once('message', finish);
    worker.once('error', (error) => finish({ ok: false, error: String(error.message).slice(0, 512) }));
    worker.once('exit', (code) => {
      if (code !== 0) finish({ ok: false, error: 'filter worker stopped' });
    });
  });
}

async function handleGraphql(body) {
  if (typeof body.query !== 'string' || body.query.length < 1 || body.query.length > 4096) {
    return graphqlError('query must be a non-empty string');
  }
  if (/__schema|__type/u.test(body.query)) return graphqlError('GraphQL introspection is disabled', 'GRAPHQL_VALIDATION_FAILED');
  if (!/taskGroups\s*\(\s*filter\s*:\s*\$filter\s*\)/u.test(body.query)) {
    return graphqlError('Cannot query field with this argument shape', 'GRAPHQL_VALIDATION_FAILED');
  }
  const variables = body.variables;
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return graphqlError('variables must be an object');
  const outerFilter = variables.filter;
  if (!outerFilter || typeof outerFilter !== 'object' || Array.isArray(outerFilter)) return graphqlError('filter must be a JSON object');
  if (!outerFilter.tasks || typeof outerFilter.tasks !== 'object' || Array.isArray(outerFilter.tasks)) {
    return graphqlError('filter.tasks must be a JSON object');
  }

  const evaluated = await evaluateFilter(outerFilter.tasks);
  if (!evaluated.ok) return graphqlError(`Filter evaluation failed: ${evaluated.error}`, 'INTERNAL_SERVER_ERROR');
  return {
    data: {
      taskGroups: {
        edges: evaluated.matches.map((record) => ({
          node: { taskGroupId: record.taskGroupId, name: record.name, state: record.task.state },
        })),
      },
    },
  };
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url ?? '/', 'http://evaluator.internal');
  } catch {
    sendJson(res, 400, { error: 'bad_request' });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/healthz') return sendJson(res, 200, { ok: true, service: 'filter-evaluator' });
  if (req.method !== 'POST' || url.pathname !== '/internal/graphql') return sendJson(res, 404, { error: 'not_found' });
  if (!trustedProxy(req)) return sendJson(res, 403, { error: 'proxy_only' });

  try {
    const body = await readJson(req);
    sendJson(res, 200, await handleGraphql(body));
  } catch (error) {
    sendJson(res, error.message === 'too large' ? 413 : 400, { error: error.message === 'too large' ? 'request_too_large' : 'invalid_json' });
  }
});

server.maxHeadersCount = 32;
server.headersTimeout = 5_000;
server.requestTimeout = 4_000;
server.keepAliveTimeout = 3_000;
server.listen(PORT, HOST, () => console.log(`graphql-gambit evaluator listening on ${HOST}:${PORT}`));
