import http from 'node:http';

const HOST = process.env.GATEWAY_HOST ?? '127.0.0.1';
const PORT = numberFromEnv('GATEWAY_PORT', 3000);
const EVALUATOR_HOST = process.env.EVALUATOR_HOST ?? '127.0.0.1';
const EVALUATOR_PORT = numberFromEnv('EVALUATOR_PORT', 4200);
const PROXY_SECRET = process.env.PROXY_SECRET ?? '';
const MAX_BODY_BYTES = 16 * 1024;

if (!/^[a-f0-9]{64}$/i.test(PROXY_SECRET)) throw new Error('PROXY_SECRET must be 64 hexadecimal characters');

const style = `
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; background: #07131c; color: #effaff; }
  main { width: min(900px, calc(100% - 2rem)); margin: 5vh auto; }
  h1 { font-size: clamp(2.7rem, 8vw, 5.5rem); letter-spacing: -.06em; margin: 0; }
  p { color: #a8c2ce; line-height: 1.6; }
  section { background: #0d202c; border: 1px solid #24495b; border-radius: 18px; padding: 1.3rem; margin: 1rem 0; }
  textarea, button { box-sizing: border-box; width: 100%; border-radius: 10px; border: 1px solid #38677d; padding: .8rem 1rem; font: inherit; }
  textarea { min-height: 8rem; resize: vertical; background: #051018; color: #e9f9ff; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  button { margin-top: .8rem; background: #6fdbef; color: #03222b; font-weight: 800; cursor: pointer; }
  pre, code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #040c12; border-radius: 12px; padding: 1rem; min-height: 4rem; color: #bdeaf5; }
  .badge { display: inline-block; border-radius: 999px; padding: .25rem .65rem; color: #aeeafb; background: #123446; font-size: .8rem; }
`;

const homePage = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GraphQL Gambit</title><style>${style}</style><script src="/assets/explorer.js" defer></script></head>
<body><main><span class="badge">CI TASK EXPLORER · WEB 100.2</span><h1>GraphQL Gambit</h1>
<p>공개 빌드 큐를 익명으로 검색할 수 있는 CI task explorer입니다. 운영 데이터와 credential은 표시되지 않습니다.</p>
<section><h2>Task filter</h2><form id="filter-form"><label for="filter">Filter JSON</label><textarea id="filter" spellcheck="false">{"state":{"$eq":"running"}}</textarea><button type="submit">Run query</button></form><pre id="output">No query yet.</pre></section>
<section><h2>API notes</h2><p>GraphQL introspection은 운영 환경에서 비활성화했습니다. 브라우저 client bundle은 배포 진단을 위해 source map을 유지합니다.</p></section>
<p>anonymous role: queue:read · web-server 100.2.1-sim</p></main></body></html>`;

const clientScript = `const query = \`query TaskGroupSearch($filter: JSON) {
  taskGroups(filter: $filter) { edges { node { taskGroupId name state } } }
}\`;
const output = document.querySelector('#output');
document.querySelector('#filter-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  let tasks;
  try { tasks = JSON.parse(document.querySelector('#filter').value); }
  catch { output.textContent = 'Filter must be valid JSON.'; return; }
  const response = await fetch('/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { filter: { tasks } } }),
  });
  output.textContent = JSON.stringify(await response.json(), null, 2);
});
//# sourceMappingURL=explorer.js.map
`;

const schema = `scalar JSON

type Query {
  taskGroups(filter: JSON): TaskGroupConnection!
}

type TaskGroupConnection { edges: [TaskGroupEdge!]! }
type TaskGroupEdge { node: TaskGroup! }
type TaskGroup { taskGroupId: ID!, name: String!, state: String! }
`;

const sourceMap = {
  version: 3,
  file: 'explorer.js',
  sources: ['webpack://graphql-gambit/src/taskGroupSearch.ts', 'webpack://graphql-gambit/src/api.ts'],
  names: [],
  mappings: '',
  sourcesContent: [
    `import schemaUrl from '/assets/schema.graphql';\n\n// Resolver contract: the public editor value is nested under filter.tasks.\nexport const variablesFor = (editorValue: unknown) => ({\n  filter: { tasks: editorValue },\n});\n`,
    `export const endpoint = '/graphql';\nexport const introspection = false;\nexport const anonymousScopes = ['queue:read'];\n`,
  ],
};

function numberFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

function send(res, status, contentType, value, extra = {}) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value ?? '', 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    'Referrer-Policy': 'no-referrer',
    'Server': 'ci-explorer/100.2.1-sim',
    ...extra,
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function proxyGraphql(body) {
  return new Promise((resolvePromise, reject) => {
    const request = http.request({
      host: EVALUATOR_HOST,
      port: EVALUATOR_PORT,
      path: '/internal/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
        'X-Proxy-Secret': PROXY_SECRET,
        Connection: 'close',
      },
      timeout: 3_000,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 32 * 1024) chunks.push(chunk);
      });
      response.on('end', () => {
        if (size > 32 * 1024) return reject(new Error('upstream response too large'));
        resolvePromise({ status: response.statusCode ?? 502, body: Buffer.concat(chunks) });
      });
    });
    request.on('timeout', () => request.destroy(new Error('upstream timeout')));
    request.on('error', reject);
    request.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url ?? '/', 'http://challenge.local');
  } catch {
    sendJson(res, 400, { error: 'bad_request' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', homePage);
  if (req.method === 'GET' && url.pathname === '/healthz') return sendJson(res, 200, { ok: true, service: 'graphql-gateway' });
  if (req.method === 'GET' && url.pathname === '/assets/explorer.js') return send(res, 200, 'application/javascript; charset=utf-8', clientScript);
  if (req.method === 'GET' && url.pathname === '/assets/explorer.js.map') return sendJson(res, 200, sourceMap);
  if (req.method === 'GET' && url.pathname === '/assets/schema.graphql') return send(res, 200, 'text/plain; charset=utf-8', schema);
  if (url.pathname === '/graphql' && req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (req.method !== 'POST' || url.pathname !== '/graphql') return sendJson(res, 404, { error: 'not_found' });

  try {
    const body = await readBody(req);
    if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] ?? ''))) {
      sendJson(res, 415, { error: 'application_json_required' });
      return;
    }
    JSON.parse(body.toString('utf8'));
    const upstream = await proxyGraphql(body);
    send(res, upstream.status, 'application/json; charset=utf-8', upstream.body);
  } catch (error) {
    const status = error.message === 'too large' ? 413 : error instanceof SyntaxError ? 400 : 502;
    sendJson(res, status, { error: status === 413 ? 'request_too_large' : status === 400 ? 'invalid_json' : 'evaluator_unavailable' });
  }
});

server.maxHeadersCount = 32;
server.headersTimeout = 5_000;
server.requestTimeout = 5_000;
server.keepAliveTimeout = 3_000;
server.listen(PORT, HOST, () => console.log(`graphql-gambit gateway listening on ${HOST}:${PORT}`));
