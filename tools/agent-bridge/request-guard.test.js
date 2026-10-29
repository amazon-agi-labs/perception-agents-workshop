// Copyright 2026 Amazon Inc
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// Unit tests for the shared request guard. Run: node --test
const test = require('node:test');
const assert = require('node:assert');
const { checkRequest, allowedOrigin, safeLocalUrl, setAllowedOrigins } = require('./request-guard');

const req = (method, url, headers) => ({ method: method, url: url, headers: headers || {} });
const JSON_ROUTES = ['/api/apply'];
const APP_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

test.beforeEach(() => setAllowedOrigins(APP_ORIGINS));

test('Host must be loopback on the listening port', () => {
  assert.strictEqual(checkRequest(req('GET', '/', { host: 'localhost:9999' }), 9999, JSON_ROUTES), null);
  assert.strictEqual(checkRequest(req('GET', '/', { host: '127.0.0.1:9999' }), 9999, JSON_ROUTES), null);
  assert.strictEqual(checkRequest(req('GET', '/', { host: 'LOCALHOST:9999' }), 9999, JSON_ROUTES), null);
  for (const h of [undefined, '', 'localhost', 'localhost:9998', 'evil.example:9999', 'localhost.evil.example:9999', '127.0.0.1.nip.io:9999', '[::1]:9999']) {
    assert.strictEqual(checkRequest(req('GET', '/', { host: h }), 9999, JSON_ROUTES).status, 403, String(h));
  }
});

test('foreign Origin on POST/DELETE is 403, missing Origin is allowed', () => {
  const h = o => Object.assign({ host: 'localhost:1', 'content-type': 'application/json' }, o ? { origin: o } : {});
  assert.strictEqual(checkRequest(req('POST', '/api/apply', h()), 1, JSON_ROUTES), null);
  assert.strictEqual(checkRequest(req('POST', '/api/apply', h('http://localhost:5173')), 1, JSON_ROUTES), null);
  for (const o of ['https://evil.example', 'null', 'http://localhost.evil.example', 'chrome-extension://abc']) {
    assert.strictEqual(checkRequest(req('POST', '/api/apply', h(o)), 1, JSON_ROUTES).status, 403, o);
    assert.strictEqual(checkRequest(req('DELETE', '/api/x', h(o)), 1, JSON_ROUTES).status, 403, o);
  }
  // GET with a foreign Origin passes the guard; the response simply carries no ACAO.
  assert.strictEqual(checkRequest(req('GET', '/api/x', h('https://evil.example')), 1, JSON_ROUTES), null);
});

test('JSON routes require an application/json media type on POST', () => {
  const h = ct => Object.assign({ host: 'localhost:1' }, ct === undefined ? {} : { 'content-type': ct });
  for (const ct of ['application/json', 'application/json; charset=utf-8', 'Application/JSON']) {
    assert.strictEqual(checkRequest(req('POST', '/api/apply', h(ct)), 1, JSON_ROUTES), null, ct);
  }
  for (const ct of [undefined, '', 'text/plain', 'text/plain; x=application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonx']) {
    assert.strictEqual(checkRequest(req('POST', '/api/apply', h(ct)), 1, JSON_ROUTES).status, 415, String(ct));
  }
  assert.strictEqual(checkRequest(req('POST', '/api/apply?x=1', h('text/plain')), 1, JSON_ROUTES).status, 415);
  assert.strictEqual(checkRequest(req('POST', '/api/other', h('text/plain')), 1, JSON_ROUTES), null);
});

test('allowedOrigin accepts only http(s) localhost / 127.0.0.1', () => {
  assert.strictEqual(allowedOrigin(req('GET', '/', { origin: 'http://127.0.0.1:5173' })), 'http://127.0.0.1:5173');
  assert.strictEqual(allowedOrigin(req('GET', '/', {})), null);
  assert.strictEqual(allowedOrigin(req('GET', '/', { origin: 'file://' })), null);
});

test('safeLocalUrl keeps http(s) localhost URLs and drops everything else', () => {
  assert.strictEqual(safeLocalUrl('http://localhost:5173/x', 'D'), 'http://localhost:5173/x');
  assert.strictEqual(safeLocalUrl('https://localhost:5173/', 'D'), 'https://localhost:5173/');
  assert.strictEqual(safeLocalUrl('http://127.0.0.1:1/a";touch x;"', 'D'), 'http://127.0.0.1:1/a%22;touch%20x;%22');
  for (const u of [undefined, '', 'http://evil.example/', 'https://evil.example/', 'ftp://localhost/', 'file:///etc/passwd', 'http://localhost@evil.example/', 'http://user:pw@localhost/', 'not a url', '$(id)']) {
    assert.strictEqual(safeLocalUrl(u, 'D'), 'D', String(u));
  }
});

test('only configured origins are allowed, and nothing until configured', () => {
  const o = origin => allowedOrigin(req('GET', '/', { origin: origin }));
  setAllowedOrigins([]);
  assert.strictEqual(o('http://localhost:5173'), null);
  setAllowedOrigins(APP_ORIGINS);
  assert.strictEqual(o('http://localhost:5173'), 'http://localhost:5173');
  assert.strictEqual(o('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
  assert.strictEqual(o('HTTP://LOCALHOST:5173'), 'http://localhost:5173');
  for (const other of ['http://localhost:8888', 'https://localhost:5173', 'http://localhost', 'http://127.0.0.1:9999', 'http://localhost:5173.evil.example', 'null']) {
    assert.strictEqual(o(other), null, other);
  }
  const post = origin => checkRequest(req('POST', '/api/apply', { host: 'localhost:1', origin: origin, 'content-type': 'application/json' }), 1, JSON_ROUTES);
  assert.strictEqual(post('http://localhost:8888').status, 403);
  assert.strictEqual(post('http://localhost:5173'), null);
});

test('setAllowedOrigins accepts only bare http(s) origins', () => {
  for (const bad of ['*', 'null', 'localhost:5173', 'file:///x', 'http://localhost:5173/path', 'http://user@localhost:5173']) {
    assert.throws(() => setAllowedOrigins([bad]), /origin/i, bad);
  }
  setAllowedOrigins(['http://localhost:3000/']);
  assert.strictEqual(allowedOrigin(req('GET', '/', { origin: 'http://localhost:3000' })), 'http://localhost:3000');
});
