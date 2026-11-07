import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error módulo JS de las funciones de Vercel (runtime edge)
import handler from '../api/sample.js';

const realFetch = globalThis.fetch;
const R2 = 'https://pub-abc123.r2.dev/kit/bd.wav';
const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  handler(new Request('https://telar.example' + path, { ...init, headers: { 'sec-fetch-site': 'same-origin', ...(init.headers ?? {}) } })) as Promise<Response>;

test('proxy de samples: nunca sirve HTML ni script desde el dominio de Telar', async () => {
  globalThis.fetch = (async () => new Response('<script>alert(1)</script>', { headers: { 'content-type': 'text/html' } })) as typeof fetch;
  try {
    const r = await call('/api/sample?url=' + encodeURIComponent(R2));
    assert.equal(r.headers.get('content-type'), 'application/octet-stream');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  } finally { globalThis.fetch = realFetch; }
  globalThis.fetch = (async () => new Response('RIFF', { headers: { 'content-type': 'audio/wav' } })) as typeof fetch;
  try {
    const r = await call('/api/sample?url=' + encodeURIComponent(R2));
    assert.equal(r.headers.get('content-type'), 'audio/wav');
  } finally { globalThis.fetch = realFetch; }
});

test('proxy de samples: solo R2, solo desde la propia Telar', async () => {
  assert.equal((await call('/api/sample?url=' + encodeURIComponent('https://evil.example/x.wav'))).status, 400);
  const r = await handler(new Request('https://telar.example/api/sample?url=' + encodeURIComponent(R2), { headers: { 'sec-fetch-site': 'cross-site' } }));
  assert.equal(r.status, 403);
});

test('candado: cookie HttpOnly con un HMAC, no la contraseña', async () => {
  process.env.CLOUD_BANK_PW = 'clave-secreta';
  try {
    assert.equal((await call('/api/sample?probe=1')).status, 401);
    const bad = await call('/api/sample?login=1', { method: 'POST', body: JSON.stringify({ pw: 'otra' }) });
    assert.equal(bad.status, 401);
    const ok = await call('/api/sample?login=1', { method: 'POST', body: JSON.stringify({ pw: 'clave-secreta' }) });
    assert.equal(ok.status, 200);
    const sc = ok.headers.get('set-cookie') ?? '';
    assert.match(sc, /^cb_tok=[0-9a-f]{64};/);
    assert.match(sc, /HttpOnly/);
    assert.ok(!sc.includes('clave-secreta'));
    const tok = sc.split(';')[0];
    assert.equal((await call('/api/sample?probe=1', { headers: { cookie: tok } })).status, 200);
    assert.equal((await call('/api/sample?probe=1', { headers: { cookie: 'cb_pw=clave-secreta' } })).status, 200); // la vieja aún entra
  } finally { delete process.env.CLOUD_BANK_PW; }
});
