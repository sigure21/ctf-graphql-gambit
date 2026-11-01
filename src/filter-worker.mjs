import { parentPort, workerData } from 'node:worker_threads';

function compileMatcher(expression) {
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) {
    throw new TypeError('filter expression must be an object');
  }

  const matchers = [];
  for (const [key, value] of Object.entries(expression)) {
    if (key === '$where') {
      if (typeof value !== 'string' || value.length < 1 || value.length > 1024) {
        throw new TypeError('$where must be a non-empty string');
      }
      // Deliberately vulnerable educational model of sift 17.1.3's behavior.
      const predicate = new Function('obj', `"use strict"; return (${value});`);
      matchers.push((obj) => Boolean(predicate(obj)));
      continue;
    }
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new TypeError(`${key} must be a non-empty array`);
      const nested = value.map(compileMatcher);
      matchers.push((obj) => key === '$and' ? nested.every((test) => test(obj)) : nested.some((test) => test(obj)));
      continue;
    }
    if (key.startsWith('$')) throw new TypeError(`unsupported operator: ${key}`);
    matchers.push((obj) => matchValue(obj?.[key], value));
  }
  return (obj) => matchers.every((test) => test(obj));
}

function matchValue(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (Object.hasOwn(expected, '$eq')) return actual === expected.$eq;
    if (Object.hasOwn(expected, '$in')) return Array.isArray(expected.$in) && expected.$in.includes(actual);
    return compileMatcher(expected)(actual);
  }
  return actual === expected;
}

try {
  const predicate = compileMatcher(workerData.filter);
  const matches = workerData.records.filter((record) => predicate(record.task));
  parentPort.postMessage({ ok: true, matches });
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error?.message ?? 'filter evaluation failed').slice(0, 512) });
}
