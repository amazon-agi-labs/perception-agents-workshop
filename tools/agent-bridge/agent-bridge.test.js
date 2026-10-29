// Copyright 2026 Amazon Inc
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// Request-forgery tests for agent-bridge. Run: node --test
// child_process is stubbed (tools/test-support), so no AI CLI or Python ever runs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { startServer, request, sleep } = require('../test-support/harness');

const SCRIPT = path.join(__dirname, 'agent-bridge.js');
const KEY_ENV = { NOVA_ACT_API_KEY: 'test-placeholder-not-a-key' };
const bridgeArgs = (port, tmp) => ['--port', String(port), '--feedback', path.join(tmp, 'feedback.json'), '--app-dir', tmp, '--cli', 'stub-cli'];
const cliCalls = s => s.childCalls().filter(c => c.fn === 'exec' || c.fn === 'execFile');
const APPLY_BODY = JSON.stringify({ annotations: [{ feedback: 'make it blue', selector: '.x' }] });

let bridge;
test.before(async () => {
  bridge = await startServer(SCRIPT, bridgeArgs, KEY_ENV);
  assert.ok(!bridge.exited && !bridge.timeout, 'bridge failed to start: ' + bridge.stderr());
});
test.after(() => bridge && bridge.stop());

test('text/plain POST /api/apply is rejected with 415 and runs nothing', async () => {
  const before = cliCalls(bridge).length;
  const r = await request(bridge.port, { method: 'POST', path: '/api/apply', headers: { 'content-type': 'text/plain' }, body: APPLY_BODY });
  await sleep(300);
  assert.strictEqual(r.status, 415);
  assert.strictEqual(cliCalls(bridge).length, before, 'CLI was invoked for a text/plain request');
});

test('text/plain POST /api/chat and /api/feedback are rejected with 415', async () => {
  const chat = await request(bridge.port, { method: 'POST', path: '/api/chat', headers: { 'content-type': 'text/plain' }, body: '{"question":"hi"}' });
  const fb = await request(bridge.port, { method: 'POST', path: '/api/feedback', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: '{"feedback":"x"}' });
  assert.strictEqual(chat.status, 415);
  assert.strictEqual(fb.status, 415);
  assert.ok(!fs.existsSync(path.join(bridge.tmpDir, 'feedback.json')), 'feedback file was written');
});

test('POST /api/apply from a foreign Origin is rejected with 403 and runs nothing', async () => {
  const before = cliCalls(bridge).length;
  const r = await request(bridge.port, { method: 'POST', path: '/api/apply', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: APPLY_BODY });
  await sleep(300);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(cliCalls(bridge).length, before, 'CLI was invoked for a foreign-origin request');
});

test('DELETE /api/feedback from a foreign Origin is rejected with 403', async () => {
  const r = await request(bridge.port, { method: 'DELETE', path: '/api/feedback', headers: { origin: 'https://evil.example' } });
  assert.strictEqual(r.status, 403);
});

test('a request with a non-loopback Host (DNS rebinding) is rejected with 403', async () => {
  const get = await request(bridge.port, { path: '/api/apply/status', headers: { host: 'rebind.evil.example:' + bridge.port } });
  const post = await request(bridge.port, { method: 'POST', path: '/api/apply', headers: { host: 'rebind.evil.example:' + bridge.port, 'content-type': 'application/json' }, body: APPLY_BODY });
  const wrongPort = await request(bridge.port, { path: '/api/report/latest', headers: { host: 'localhost:1' } });
  assert.strictEqual(get.status, 403);
  assert.strictEqual(post.status, 403);
  assert.strictEqual(wrongPort.status, 403);
});

test('localhost Origin with application/json still works (extension flow)', async () => {
  const dev = http.createServer((q, s) => { s.writeHead(200); s.end('ok'); });
  await new Promise(r => dev.listen(0, '127.0.0.1', r));
  try {
    const before = cliCalls(bridge).length;
    const body = JSON.stringify({ annotations: [{ feedback: 'blue', selector: '.x' }], url: 'http://127.0.0.1:' + dev.address().port + '/' });
    const r = await request(bridge.port, { method: 'POST', path: '/api/apply', headers: { host: 'localhost:' + bridge.port, origin: 'http://localhost:5173', 'content-type': 'application/json; charset=utf-8' }, body: body });
    await sleep(500);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.ok(cliCalls(bridge).length > before, 'CLI stub was not invoked');
  } finally { dev.close(); }
});

test('no Origin (curl) with application/json is accepted', async () => {
  const r = await request(bridge.port, { method: 'POST', path: '/api/feedback', headers: { 'content-type': 'application/json' }, body: '{"feedback":"x"}' });
  assert.strictEqual(r.status, 200);
});

test('guard rejections stay readable by a localhost caller', async () => {
  const r = await request(bridge.port, { method: 'POST', path: '/api/apply', headers: { origin: 'http://localhost:5173', 'content-type': 'text/plain' }, body: APPLY_BODY });
  assert.strictEqual(r.status, 415);
  assert.strictEqual(r.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.match(JSON.parse(r.body).error, /application\/json/);
});

test('report view forbids scripts', async () => {
  const dir = path.join(bridge.tmpDir, '.ui-verification', 'reports', '20260101-000000Z');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.md'), '# Report\n\n<img src=x onerror="alert(1)">');
  const r = await request(bridge.port, { path: '/api/report/view' });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers['content-security-policy'] || '', /default-src 'none'/);
  for (const d of ["form-action 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
    assert.ok(r.headers['content-security-policy'].includes(d), 'CSP lacks ' + d);
  }
  assert.doesNotMatch(r.headers['content-security-policy'], /script-src/);
});

test('preflight from a foreign Origin is refused', async () => {
  const r = await request(bridge.port, { method: 'OPTIONS', path: '/api/apply', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.strictEqual(r.status, 403);
});

test('a localhost page on another port cannot drive the bridge', async () => {
  const before = cliCalls(bridge).length;
  const post = await request(bridge.port, { method: 'POST', path: '/api/apply', headers: { origin: 'http://localhost:8888', 'content-type': 'application/json' }, body: APPLY_BODY });
  const pre = await request(bridge.port, { method: 'OPTIONS', path: '/api/apply', headers: { origin: 'http://localhost:8888', 'access-control-request-method': 'POST' } });
  const del = await request(bridge.port, { method: 'DELETE', path: '/api/feedback', headers: { origin: 'http://127.0.0.1:8888' } });
  await sleep(300);
  assert.strictEqual(post.status, 403);
  assert.strictEqual(pre.status, 403);
  assert.strictEqual(del.status, 403);
  assert.strictEqual(cliCalls(bridge).length, before, 'CLI was invoked for another localhost origin');
  assert.match(JSON.parse(post.body).error, /--allow-origin/);
});

test('--allow-origin replaces the default app origin', async () => {
  const s = await startServer(SCRIPT, (port, tmp) => bridgeArgs(port, tmp).concat(['--allow-origin', 'http://localhost:3000']), KEY_ENV);
  try {
    assert.ok(!s.exited && !s.timeout, 'bridge failed to start: ' + s.stderr());
    const fb = origin => request(s.port, { method: 'POST', path: '/api/feedback', headers: { origin: origin, 'content-type': 'application/json' }, body: '{"feedback":"x"}' });
    assert.strictEqual((await fb('http://localhost:3000')).status, 200);
    assert.strictEqual((await fb('http://localhost:5173')).status, 403);
  } finally { s.stop(); }
});

test('--allow-origin with a wildcard is refused at startup', async () => {
  const s = await startServer(SCRIPT, (port, tmp) => bridgeArgs(port, tmp).concat(['--allow-origin', '*']), KEY_ENV);
  s.stop();
  assert.ok(s.exited, 'bridge started with --allow-origin *');
  assert.notStrictEqual(s.code, 0);
});

test('the AI CLI does not get NOVA_ACT_API_KEY in its environment', () => {
  // The extension-flow test above ran an apply; every CLI exec must lack the key.
  const execs = bridge.childCalls().filter(c => c.fn === 'exec');
  assert.ok(execs.length > 0, 'no CLI exec recorded');
  for (const c of execs) assert.strictEqual(c.novaKeyInEnv, false, 'CLI env carries the key: ' + c.args[0].slice(0, 40));
  const verify = bridge.childCalls().filter(c => c.fn === 'execFile' && JSON.stringify(c.args).includes('verify-with-nova-act.py'));
  assert.ok(verify.length > 0, 'no verification recorded');
  for (const c of verify) assert.strictEqual(c.novaKeyInEnv, true, 'verification env lacks the key');
});

test('an https app url does not crash the bridge', async () => {
  const s = await startServer(SCRIPT, bridgeArgs, KEY_ENV);
  try {
    const r = await request(s.port, { method: 'POST', path: '/api/apply', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: JSON.stringify({ annotations: [{ feedback: 'x', selector: '.x' }], url: 'https://127.0.0.1:1/' }) });
    assert.strictEqual(r.status, 200);
    await sleep(1500);
    assert.ok(s.proc.exitCode === null && s.proc.signalCode === null, 'bridge exited: ' + s.stderr().slice(-300));
    assert.strictEqual((await request(s.port, { path: '/api/apply/status' })).status, 200);
  } finally { s.stop(); }
});

test('--allow-origin with an empty list is refused at startup', async () => {
  for (const extra of [['--allow-origin', ','], ['--allow-origin', ''], ['--allow-origin']]) {
    const s = await startServer(SCRIPT, (port, tmp) => bridgeArgs(port, tmp).concat(extra), KEY_ENV);
    s.stop();
    assert.ok(s.exited, 'bridge started with ' + JSON.stringify(extra));
    assert.notStrictEqual(s.code, 0);
  }
});

test('a dev server that never answers does not stall the apply job', async () => {
  // Accepts TCP and never replies, so a poll with no timeout would wait forever.
  const conns = [];
  const silent = require('net').createServer(c => conns.push(c));
  await new Promise(r => silent.listen(0, '127.0.0.1', r));
  const s = await startServer(SCRIPT, bridgeArgs, KEY_ENV);
  try {
    const url = 'http://127.0.0.1:' + silent.address().port + '/';
    const r = await request(s.port, { method: 'POST', path: '/api/apply', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: JSON.stringify({ annotations: [{ feedback: 'x', selector: '.x' }], url: url }) });
    assert.strictEqual(r.status, 200);
    // One timed-out attempt plus the 2 s retry delay means a second connection.
    const deadline = Date.now() + 16000;
    while (conns.length < 2 && Date.now() < deadline) await sleep(200);
    assert.ok(conns.length >= 2, 'dev-server poll never retried (stalled on a silent socket)');
  } finally { s.stop(); conns.forEach(c => c.destroy()); silent.close(); }
});

test('a dev server that sends headers then stalls gets exactly one verification', async () => {
  // Answers 200 and never ends the body, like streaming SSR or SSE.
  const held = [];
  let closed = 0;
  const stall = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.write('<html>'); held.push(s); s.socket.on('close', () => closed++); });
  await new Promise(r => stall.listen(0, '127.0.0.1', r));
  const s = await startServer(SCRIPT, bridgeArgs, KEY_ENV);
  try {
    const url = 'http://127.0.0.1:' + stall.address().port + '/';
    const r = await request(s.port, { method: 'POST', path: '/api/apply', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: JSON.stringify({ annotations: [{ feedback: 'x', selector: '.x' }], url: url }) });
    assert.strictEqual(r.status, 200);
    // Past the per-attempt timeout plus a retry delay: a still-armed timer would re-poll.
    await sleep(14000);
    const verifies = s.childCalls().filter(c => JSON.stringify(c.args).includes('verify-with-nova-act.py'));
    assert.strictEqual(verifies.length, 1, 'verification ran ' + verifies.length + ' times');
    // Only the status code is needed, so the bridge must not keep the stalled response open.
    assert.strictEqual(closed, held.length, 'bridge left ' + (held.length - closed) + ' dev-server connection(s) open');
  } finally { s.stop(); held.forEach(x => x.destroy()); stall.close(); }
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

test('a dev server that trickles headers forever is given up on and retried', async () => {
  const conns = [];
  const srv = await trickleServer(conns);
  const s = await startServer(SCRIPT, bridgeArgs, KEY_ENV);
  try {
    const url = 'http://127.0.0.1:' + srv.address().port + '/';
    const r = await request(s.port, { method: 'POST', path: '/api/apply', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: JSON.stringify({ annotations: [{ feedback: 'x', selector: '.x' }], url: url }) });
    assert.strictEqual(r.status, 200);
    const deadline = Date.now() + 16000;
    while (conns.length < 2 && Date.now() < deadline) await sleep(200);
    assert.ok(conns.length >= 2, 'poll never gave up on a server that trickles headers');
  } finally { s.stop(); conns.forEach(c => c.destroy()); srv.close(); }
});

// Since the response is closed right after its status is read, a later reset normally
// lands on a closed socket; this pins the end result (one verification, no crash).
test('a dev server that sends headers then resets gets exactly one verification', async () => {
  const reset = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.write('<html>'); setTimeout(() => s.socket.resetAndDestroy(), 200); });
  await new Promise(r => reset.listen(0, '127.0.0.1', r));
  const s = await startServer(SCRIPT, bridgeArgs, KEY_ENV);
  try {
    const url = 'http://127.0.0.1:' + reset.address().port + '/';
    const r = await request(s.port, { method: 'POST', path: '/api/apply', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: JSON.stringify({ annotations: [{ feedback: 'x', selector: '.x' }], url: url }) });
    assert.strictEqual(r.status, 200);
    await sleep(7000);
    assert.ok(s.proc.exitCode === null, 'bridge exited: ' + s.stderr().slice(-300));
    const verifies = s.childCalls().filter(c => JSON.stringify(c.args).includes('verify-with-nova-act.py'));
    assert.strictEqual(verifies.length, 1, 'verification ran ' + verifies.length + ' times');
  } finally { s.stop(); reset.close(); }
});

test('startup fails clearly when NOVA_ACT_API_KEY is not set', async () => {
  const s = await startServer(SCRIPT, bridgeArgs, { NOVA_ACT_API_KEY: undefined });
  s.stop();
  assert.ok(s.exited, 'bridge started without NOVA_ACT_API_KEY');
  assert.notStrictEqual(s.code, 0);
  assert.match(s.stderr(), /NOVA_ACT_API_KEY/);
});

test('source has no hardcoded API key fallback', () => {
  const src = fs.readFileSync(SCRIPT, 'utf-8');
  // Any UUID-shaped literal (the Nova Act key format). Message only: never echo the
  // matching source, which would print the key.
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(src), 'UUID-shaped literal (possible API key) in agent-bridge.js');
});
