// Copyright 2026 Amazon Inc
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// Request-forgery and command-injection tests for proxy-worker.
// Run: node --test. child_process is stubbed (tools/test-support), so the AI CLI,
// the bee CLI and the verification script never run.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { startServer, request, sleep, waitFor } = require('../test-support/harness');

const SCRIPT = path.join(__dirname, 'proxy-worker.js');
let dev, proxy;

test.before(async () => {
  dev = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/plain' }); s.end('dev'); });
  await new Promise(r => dev.listen(0, '127.0.0.1', r));
  const devUrl = 'http://127.0.0.1:' + dev.address().port;
  proxy = await startServer(SCRIPT, (port, tmp) => [
    '--target', devUrl, '--port', String(port), '--feedback', path.join(tmp, 'feedback.json'),
    '--inspector-script', path.join(__dirname, 'inspector.js'), '--app-dir', tmp, '--cli', 'stub-cli',
  ], { NOVA_ACT_API_KEY: 'test-placeholder-not-a-key' });
  assert.ok(!proxy.exited && !proxy.timeout, 'proxy failed to start: ' + proxy.stderr());
});
test.after(() => { proxy && proxy.stop(); dev && dev.close(); });

const execCalls = () => proxy.childCalls().filter(c => c.fn === 'exec' || c.fn === 'execFile');

test('binds to 127.0.0.1 only', () => {
  const listen = proxy.childCalls().find(c => c.fn === 'listen');
  assert.ok(listen, 'no listen call recorded');
  assert.strictEqual(listen.args[1], '127.0.0.1');
});

test('text/plain POST /api/bee/apply is rejected with 415 and runs nothing', async () => {
  const before = execCalls().length;
  const r = await request(proxy.port, { method: 'POST', path: '/api/bee/apply', headers: { 'content-type': 'text/plain' }, body: '{"instruction":"make it blue"}' });
  await sleep(300);
  assert.strictEqual(r.status, 415);
  assert.strictEqual(execCalls().length, before, 'CLI was invoked for a text/plain request');
});

test('POST /api/bee/apply from a foreign Origin is rejected with 403', async () => {
  const before = execCalls().length;
  const r = await request(proxy.port, { method: 'POST', path: '/api/bee/apply', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"instruction":"x"}' });
  await sleep(300);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(execCalls().length, before);
});

test('foreign-Origin preflight is refused and no response carries ACAO *', async () => {
  const pre = await request(proxy.port, { method: 'OPTIONS', path: '/api/bee/apply', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.strictEqual(pre.status, 403);
  const get = await request(proxy.port, { path: '/api/bee/conversations', headers: { origin: 'https://evil.example' } });
  assert.strictEqual(get.headers['access-control-allow-origin'], undefined);
});

test('a non-loopback Host (DNS rebinding) is rejected with 403, API and proxied routes', async () => {
  const api = await request(proxy.port, { path: '/api/bee/status', headers: { host: 'rebind.evil.example:' + proxy.port } });
  const page = await request(proxy.port, { path: '/', headers: { host: 'rebind.evil.example:' + proxy.port } });
  assert.strictEqual(api.status, 403);
  assert.strictEqual(page.status, 403);
});

test('shell metacharacters in payload.url never reach a shell', async () => {
  const evilUrl = 'http://127.0.0.1:' + dev.address().port + '/a";touch /tmp/bridge-test-pwned;echo "';
  const r = await request(proxy.port, {
    method: 'POST', path: '/api/bee/apply',
    headers: { host: 'localhost:' + proxy.port, origin: 'http://localhost:' + proxy.port, 'content-type': 'application/json' },
    body: JSON.stringify({ instruction: 'make it blue', url: evilUrl }),
  });
  assert.strictEqual(r.status, 200);
  const verify = () => execCalls().find(c => JSON.stringify(c.args).includes('verify-with-nova-act.py'));
  assert.ok(await waitFor(verify, 5000), 'verification was never invoked');
  const call = verify();
  assert.strictEqual(call.fn, 'execFile', 'verification ran through a shell: ' + JSON.stringify(call.args));
  const argv = call.args[1];
  const url = argv[argv.indexOf('--url') + 1];
  // One argv element with no shell in between; quotes and spaces arrive URL-encoded.
  assert.strictEqual(argv.length, 5);
  assert.doesNotMatch(url, /["\s]/);
  for (const c of execCalls()) assert.ok(!JSON.stringify(c.args).includes('touch /tmp/bridge-test-pwned'), 'payload reached a command line');
});

test('the AI CLI does not get NOVA_ACT_API_KEY; verification does', () => {
  // Uses the apply run recorded by the previous test.
  const cli = proxy.childCalls().filter(c => c.fn === 'exec');
  assert.ok(cli.length > 0, 'no CLI exec recorded');
  for (const c of cli) assert.strictEqual(c.novaKeyInEnv, false, 'CLI env carries the key');
  const verify = proxy.childCalls().filter(c => c.fn === 'execFile' && JSON.stringify(c.args).includes('verify-with-nova-act.py'));
  assert.ok(verify.length > 0, 'no verification recorded');
  for (const c of verify) assert.strictEqual(c.novaKeyInEnv, true, 'verification env lacks the key');
});

test('a localhost page on another port cannot drive the proxy API', async () => {
  const before = execCalls().length;
  const apply = await request(proxy.port, { method: 'POST', path: '/api/bee/apply', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: '{"instruction":"x"}' });
  const del = await request(proxy.port, { method: 'DELETE', path: '/api/bee/conversations', headers: { origin: 'http://localhost:8888' } });
  const retrieve = await request(proxy.port, { method: 'POST', path: '/api/bee/retrieve', headers: { origin: 'http://localhost:9999' } });
  await sleep(300);
  assert.strictEqual(apply.status, 403);
  assert.strictEqual(del.status, 403);
  assert.strictEqual(retrieve.status, 403);
  assert.strictEqual(execCalls().length, before);
});

test("cross-origin requests to the app's own /api/ routes are passed through", async () => {
  const post = await request(proxy.port, { method: 'POST', path: '/api/auth/callback', headers: { origin: 'https://idp.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=1' });
  const pre = await request(proxy.port, { method: 'OPTIONS', path: '/api/things', headers: { origin: 'https://other.example', 'access-control-request-method': 'POST' } });
  assert.strictEqual(post.status, 200);
  assert.strictEqual(post.body, 'dev');
  assert.strictEqual(pre.status, 200);
  assert.strictEqual(pre.body, 'dev');
});

test('cross-origin POSTs to the proxied app are passed through (only /api/ is guarded)', async () => {
  const r = await request(proxy.port, { method: 'POST', path: '/callback', headers: { origin: 'https://idp.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=1' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body, 'dev');
});

test('WebSocket upgrade from a foreign Origin is refused', async () => {
  const upgrade = origin => new Promise(resolve => {
    const req = http.request({
      host: '127.0.0.1', port: proxy.port, path: '/',
      headers: { host: 'localhost:' + proxy.port, origin: origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve('upgraded'); });
    req.on('response', res => { res.resume(); resolve('response ' + res.statusCode); });
    req.on('error', e => resolve('error ' + e.code));
    // The dev stub never answers upgrades, so a forwarded handshake just hangs.
    req.setTimeout(2000, () => { req.destroy(); resolve('forwarded (no answer)'); });
    req.end();
  });
  assert.match(await upgrade('https://evil.example'), /^error /);
  // The proxy's own page (HMR client) is still forwarded to the app.
  assert.strictEqual(await upgrade('http://localhost:' + proxy.port), 'forwarded (no answer)');
});

const proxyArgs = (target) => (port, tmp) => [
  '--target', target, '--port', String(port), '--feedback', path.join(tmp, 'feedback.json'),
  '--inspector-script', path.join(__dirname, 'inspector.js'), '--app-dir', tmp, '--cli', 'stub-cli',
];

test('--target must be a plain http loopback origin that is not the proxy itself', async () => {
  const bad = [
    proxyArgs('http://example.com'),
    proxyArgs('https://127.0.0.1:' + dev.address().port),
    proxyArgs('http://127.0.0.1:' + dev.address().port + '/sub/path'),
    (port, tmp) => proxyArgs('http://127.0.0.1:' + port)(port, tmp),
  ];
  for (const args of bad) {
    const s = await startServer(SCRIPT, args, { NOVA_ACT_API_KEY: 'test-placeholder-not-a-key' });
    s.stop();
    assert.ok(s.exited, 'proxy started with a bad --target: ' + args(1, '/x')[1]);
    assert.notStrictEqual(s.code, 0);
  }
});

test('--allow-origin with an empty value is refused at startup', async () => {
  for (const extra of [['--allow-origin', ','], ['--allow-origin', ''], ['--allow-origin']]) {
    const s = await startServer(SCRIPT, (port, tmp) => proxyArgs('http://127.0.0.1:' + dev.address().port)(port, tmp).concat(extra), { NOVA_ACT_API_KEY: 'test-placeholder-not-a-key' });
    s.stop();
    assert.ok(s.exited, 'proxy started with ' + JSON.stringify(extra));
    assert.notStrictEqual(s.code, 0);
  }
});

// Starts a proxy whose apply job polls `appUrl`; returns the verification count after `ms`.
async function verifyCountAfter(appUrl, ms) {
  const s = await startServer(SCRIPT, proxyArgs('http://127.0.0.1:' + dev.address().port), { NOVA_ACT_API_KEY: 'test-placeholder-not-a-key' });
  try {
    assert.ok(!s.exited && !s.timeout, 'proxy failed to start: ' + s.stderr());
    const r = await request(s.port, { method: 'POST', path: '/api/bee/apply', headers: { origin: 'http://localhost:' + s.port, 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'x', url: appUrl }) });
    assert.strictEqual(r.status, 200);
    await sleep(ms);
    assert.ok(s.proc.exitCode === null, 'proxy exited: ' + s.stderr().slice(-300));
    return s.childCalls().filter(c => JSON.stringify(c.args).includes('verify-with-nova-act.py')).length;
  } finally { s.stop(); }
}

test('a dev server that never answers does not stall the proxy apply job', async () => {
  const conns = [];
  const silent = require('net').createServer(c => conns.push(c));
  await new Promise(r => silent.listen(0, '127.0.0.1', r));
  try {
    await verifyCountAfter('http://127.0.0.1:' + silent.address().port + '/', 14000);
    assert.ok(conns.length >= 2, 'dev-server poll never retried (stalled on a silent socket)');
  } finally { conns.forEach(c => c.destroy()); silent.close(); }
});

test('a dev server that sends headers then stalls gets exactly one proxy verification', async () => {
  const held = [];
  let closed = 0;
  const stall = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.write('<html>'); held.push(s); s.socket.on('close', () => closed++); });
  await new Promise(r => stall.listen(0, '127.0.0.1', r));
  try {
    assert.strictEqual(await verifyCountAfter('http://127.0.0.1:' + stall.address().port + '/', 14000), 1);
    assert.strictEqual(closed, held.length, 'proxy left ' + (held.length - closed) + ' dev-server connection(s) open');
  } finally { held.forEach(x => x.destroy()); stall.close(); }
});

// Answers the status line, then one header line per second and never finishes the
// headers. An idle timeout never fires on it; only a hard deadline does.
function trickleServer(conns) {
  const srv = require('net').createServer(c => {
    conns.push(c);
    c.write('HTTP/1.1 200 OK\r\n');
    const t = setInterval(() => { try { c.write('X-Slow: 1\r\n'); } catch (_) {} }, 1000);
    c.on('close', () => clearInterval(t));
    c.on('error', () => {});
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

test('a dev server that trickles headers forever is given up on by the proxy', async () => {
  const conns = [];
  const srv = await trickleServer(conns);
  try {
    await verifyCountAfter('http://127.0.0.1:' + srv.address().port + '/', 14000);
    assert.ok(conns.length >= 2, 'poll never gave up on a server that trickles headers');
  } finally { conns.forEach(c => c.destroy()); srv.close(); }
});

// Pins the end result for a reset after headers (one verification, no crash).
test('a dev server that sends headers then resets gets exactly one proxy verification', async () => {
  const reset = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.write('<html>'); setTimeout(() => s.socket.resetAndDestroy(), 200); });
  await new Promise(r => reset.listen(0, '127.0.0.1', r));
  try {
    assert.strictEqual(await verifyCountAfter('http://127.0.0.1:' + reset.address().port + '/', 7000), 1);
  } finally { reset.close(); }
});

test('an https dev server that accepts connections is treated as up by the proxy', async () => {
  const conns = [];
  const tcp = require('net').createServer(c => conns.push(c));
  await new Promise(r => tcp.listen(0, '127.0.0.1', r));
  try {
    assert.strictEqual(await verifyCountAfter('https://127.0.0.1:' + tcp.address().port + '/', 3000), 1);
  } finally { conns.forEach(c => c.destroy()); tcp.close(); }
});

test('an https app url does not crash the proxy', async () => {
  const s = await startServer(SCRIPT, proxyArgs('http://127.0.0.1:' + dev.address().port), { NOVA_ACT_API_KEY: 'test-placeholder-not-a-key' });
  try {
    assert.ok(!s.exited && !s.timeout, 'proxy failed to start: ' + s.stderr());
    const r = await request(s.port, { method: 'POST', path: '/api/bee/apply', headers: { origin: 'http://localhost:' + s.port, 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'x', url: 'https://127.0.0.1:1/' }) });
    assert.strictEqual(r.status, 200);
    await sleep(1500);
    assert.ok(s.proc.exitCode === null && s.proc.signalCode === null, 'proxy exited: ' + s.stderr().slice(-300));
    assert.strictEqual((await request(s.port, { path: '/api/bee/status' })).status, 200);
  } finally { s.stop(); }
});
