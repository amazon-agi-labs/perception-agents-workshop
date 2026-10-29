// Copyright 2026 Amazon Inc
// Licensed under the Apache License, Version 2.0 (see LICENSE).

// Test-only preload (node --require). Replaces child_process so the servers under
// test never spawn anything: every exec/execFile/execSync/spawn call is appended as
// one JSON line to $STUB_CHILD_LOG and answered with a canned success. Every other
// way to start a process throws, so a new call site cannot run for real unnoticed.
const cp = require('child_process');
const fs = require('fs');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const logFile = process.env.STUB_CHILD_LOG;

// novaKeyInEnv: whether the child would see NOVA_ACT_API_KEY (no env option means it
// inherits ours).
function record(fn, args, opts) {
  const env = opts && opts.env ? opts.env : process.env;
  const entry = { fn: fn, args: args, novaKeyInEnv: Object.prototype.hasOwnProperty.call(env, 'NOVA_ACT_API_KEY') };
  if (logFile) fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

function optionsArg(argv) {
  return Array.prototype.find.call(argv, a => a && typeof a === 'object' && !Array.isArray(a)) || null;
}

function lastCallback(argv) {
  const cb = argv[argv.length - 1];
  return typeof cb === 'function' ? cb : null;
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = function () {};
  return child;
}

cp.exec = function (cmd) {
  record('exec', [cmd], optionsArg(arguments));
  const cb = lastCallback(arguments);
  if (cb) setImmediate(cb, null, '', '');
  return fakeChild();
};

cp.execFile = function (file, argv) {
  record('execFile', [file, Array.isArray(argv) ? argv : []], optionsArg(arguments));
  const cb = lastCallback(arguments);
  if (cb) setImmediate(cb, null, '{}', '');
  return fakeChild();
};

cp.execSync = function (cmd) {
  record('execSync', [cmd], optionsArg(arguments));
  return Buffer.from('');
};

cp.spawn = function (file, argv) {
  record('spawn', [file, Array.isArray(argv) ? argv : []], optionsArg(arguments));
  return fakeChild();
};

for (const name of ['fork', 'spawnSync', 'execFileSync']) {
  cp[name] = function () { throw new Error('stub-child-process: ' + name + ' is not stubbed; add it before using it'); };
}

// Force every server onto loopback and record the host it asked for, so a test can
// assert the bind address without ever exposing a server under test on the network.
const net = require('net');
const origListen = net.Server.prototype.listen;
net.Server.prototype.listen = function () {
  const a = Array.prototype.slice.call(arguments);
  if (typeof a[0] === 'number' || typeof a[0] === 'string') {
    const requested = typeof a[1] === 'string' ? a[1] : null;
    record('listen', [a[0], requested]);
    if (requested === null) a.splice(1, 0, '127.0.0.1');
    else a[1] = '127.0.0.1';
  }
  return origListen.apply(this, a);
};
