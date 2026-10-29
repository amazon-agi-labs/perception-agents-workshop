// Copyright 2026 Amazon Inc

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Request guard shared by agent-bridge.js and bee-annotator-solution/proxy-worker.js.
//
// Both servers run an AI CLI on request, so a web page the user happens to visit
// must not be able to drive them. CORS alone does not do that: it only stops the
// page from READING the response, while a "simple" cross-origin POST (text/plain,
// no preflight) still reaches the handler. checkRequest() refuses such requests
// server-side, before any route runs:
//
//   1. Host must be localhost:<port> or 127.0.0.1:<port>. Blocks DNS rebinding,
//      where an attacker domain re-resolves to 127.0.0.1 and becomes same-origin.
//   2. POST/DELETE carrying an Origin that is not on the server's allowlist get 403.
//      The allowlist is explicit (setAllowedOrigins), not "any localhost page": other
//      local dev servers and tools are not trusted to drive the AI CLI.
//      A request with NO Origin is allowed: browsers always send Origin on
//      cross-origin POST/DELETE, so only non-browser local clients (curl, scripts)
//      omit it.
//   3. POST to a JSON route must be Content-Type application/json. That is not a
//      CORS-safelisted type, so a browser must preflight it, and the preflight is
//      refused for foreign origins.

// Origins allowed to call the server, as normalized "scheme://host:port" strings.
// Empty until the server configures it, so a missing call fails closed.
let allowedOrigins = new Set();

// Normalize `origin` to URL.origin form, or throw if it is not a bare http(s) origin.
function normalizeOrigin(origin) {
  let u;
  try { u = new URL(origin); } catch (_) { throw new Error('Not a valid origin: ' + origin); }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password ||
      (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
    throw new Error('Not a valid origin (want e.g. http://localhost:5173): ' + origin);
  }
  return u.origin;
}

function setAllowedOrigins(list) {
  allowedOrigins = new Set(list.map(normalizeOrigin));
}

// Return the caller's Origin, normalized, if it is on the allowlist, else null. Only an
// allowed Origin is ever reflected in Access-Control-Allow-Origin.
function allowedOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return null;
  try {
    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.has(normalized)) return normalized;
  } catch (_) {}
  return null;
}

function listAllowedOrigins() {
  return Array.from(allowedOrigins);
}

function corsHeaders(req, extra) {
  const h = Object.assign({}, extra || {});
  const o = allowedOrigin(req);
  if (o) { h['Access-Control-Allow-Origin'] = o; h['Vary'] = 'Origin'; }
  return h;
}

// Exact match only: the servers bind 127.0.0.1, so other loopback spellings
// ([::1], "localhost.") are not reachable or not sent by the extension.
function isLoopbackHost(req, port) {
  const host = String((req.headers && req.headers.host) || '').toLowerCase();
  return host === 'localhost:' + port || host === '127.0.0.1:' + port;
}

// Returns null when Host is loopback on `port`, else a 403 rejection.
function checkHost(req, port) {
  if (isLoopbackHost(req, port)) return null;
  return { status: 403, reason: 'Host not allowed: ' + ((req.headers && req.headers.host) || '(none)') };
}

// Returns null unless the request carries an Origin that is not on the allowlist.
function checkOrigin(req) {
  if (req.headers && req.headers.origin && !allowedOrigin(req)) {
    return { status: 403, reason: 'Origin not allowed: ' + req.headers.origin + ' (allowed: ' +
      (listAllowedOrigins().join(', ') || 'none') + '; add yours with --allow-origin)' };
  }
  return null;
}

function isJsonContentType(req) {
  const ct = String((req.headers && req.headers['content-type']) || '');
  return ct.split(';')[0].trim().toLowerCase() === 'application/json';
}

// Returns null when the request may proceed, else { status, reason }.
// jsonRoutes: paths whose POST body is parsed as JSON.
function checkRequest(req, port, jsonRoutes) {
  const hostRejection = checkHost(req, port);
  if (hostRejection) return hostRejection;
  const method = req.method;
  if (method === 'POST' || method === 'DELETE') {
    const originRejection = checkOrigin(req);
    if (originRejection) return originRejection;
  }
  const pathname = String(req.url || '').split('?')[0];
  if (method === 'POST' && jsonRoutes.indexOf(pathname) !== -1 && !isJsonContentType(req)) {
    return { status: 415, reason: 'Content-Type must be application/json, got: ' + (req.headers['content-type'] || '(none)') };
  }
  return null;
}

// Return `url` normalized if it is an http(s) URL on localhost or 127.0.0.1 with no
// userinfo, otherwise `fallback`. Used for the dev-server URL passed to verification.
// verify-with-nova-act.py ignores TLS errors, so https dev servers are supported.
function safeLocalUrl(url, fallback) {
  if (!url) return fallback;
  try {
    const u = new URL(url);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password &&
        (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return u.toString();
    }
  } catch (_) {}
  return fallback;
}

module.exports = { setAllowedOrigins, listAllowedOrigins, allowedOrigin, corsHeaders, checkHost, checkOrigin, checkRequest, safeLocalUrl };
