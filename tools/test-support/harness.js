// Copyright 2026 Amazon Inc
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// Shared helpers for the agent-bridge and proxy-worker tests: start a server script
// on a free 127.0.0.1 port with child_process stubbed, and send raw HTTP requests.
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const STUB = path.join(__dirname, 'stub-child-process.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

// Start `script` with `args(port, tmpDir)`. Resolves once it prints READY, or with
// { exited, code, stderr } if it exits first.
async function startServer(script, args, env) {
  const port = await freePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));
  const stubLog = path.join(tmpDir, 'child-calls.jsonl');
  const childEnv = Object.assign({}, process.env, { STUB_CHILD_LOG: stubLog }, env || {});
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  const proc = spawn(process.execPath, ['--require', STUB, script].concat(args(port, tmpDir)), {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; });
  const result = await new Promise(resolve => {
    const timer = setTimeout(() => resolve({ exited: false, timeout: true }), 10000);
    proc.stdout.on('data', d => {
      if (String(d).includes('READY')) { clearTimeout(timer); resolve({ exited: false }); }
    });
    proc.on('exit', code => { clearTimeout(timer); resolve({ exited: true, code: code }); });
  });
  return Object.assign(result, {
    port: port,
    tmpDir: tmpDir,
    proc: proc,
    stderr: () => stderr,
    childCalls: () => fs.existsSync(stubLog)
      ? fs.readFileSync(stubLog, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
      : [],
    stop: () => { try { proc.kill('SIGKILL'); } catch (_) {} },
  });
}

// Send one request to 127.0.0.1:port. `headers.host` overrides the Host header.
function request(port, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: port,
      method: opts.method || 'GET',
      path: opts.path,
      headers: Object.assign({ host: '127.0.0.1:' + port }, opts.headers || {}),
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body }));
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

function waitFor(pred, ms) {
  const deadline = Date.now() + (ms || 3000);
  return new Promise(resolve => {
    (function tick() {
      if (pred()) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 50);
    })();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { startServer, request, waitFor, sleep, freePort };
