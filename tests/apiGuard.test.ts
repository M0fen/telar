import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error módulo JS de las funciones de Vercel
import { guard, sameSite, countHits } from '../api/_lib/guard.js';
// @ts-expect-error módulo JS de las funciones de Vercel
import { isTelarProjectUrl } from '../api/shorten.js';

type Res = { code: number; body: unknown; headers: Record<string, string>; status: (c: number) => Res; json: (b: unknown) => void; setHeader: (k: string, v: string) => void };
const mkRes = (): Res => {
  const r: Res = {
    code: 200, body: null, headers: {},
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; },
    setHeader(k, v) { r.headers[k.toLowerCase()] = v; },
  };
  return r;
};
const mkReq = (h: Record<string, string>) => ({ headers: { host: 'telar.example', ...h } });

test('origen: solo la propia Telar', () => {
  assert.equal(sameSite(mkReq({ 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(sameSite(mkReq({ origin: 'https://telar.example' })), true);
  assert.equal(sameSite(mkReq({ referer: 'https://telar.example/#p=abc' })), true);
  assert.equal(sameSite(mkReq({ 'sec-fetch-site': 'cross-site', origin: 'https://otro.example' })), false);
  assert.equal(sameSite(mkReq({})), false); // sin cabeceras de navegador (curl, scripts)
  process.env.TELAR_ORIGINS = 'https://mi-dominio.com';
  assert.equal(sameSite(mkReq({ 'sec-fetch-site': 'cross-site', origin: 'https://mi-dominio.com' })), true);
  delete process.env.TELAR_ORIGINS;
});

test('interruptor, tamaño y límites por IP', async () => {
  const ok = { 'sec-fetch-site': 'same-origin', 'x-real-ip': '10.0.0.1' };
  process.env.TELAR_AI_OFF = '1';
  let res = mkRes();
  assert.equal(await guard(mkReq(ok), res, 'ai'), false);
  assert.equal(res.code, 503);
  delete process.env.TELAR_AI_OFF;

  res = mkRes();
  assert.equal(await guard(mkReq({ ...ok, 'content-length': String(200 * 1024) }), res, 'ai'), false);
  assert.equal(res.code, 413);

  res = mkRes();
  assert.equal(await guard(mkReq({ origin: 'https://otro.example' }), res, 'ai'), false);
  assert.equal(res.code, 403);

  // 6 por minuto pasan, la 7.ª no (contadores en memoria: sin Upstash en los tests)
  const ip = { 'sec-fetch-site': 'same-origin', 'x-real-ip': '10.0.0.2' };
  for (let i = 0; i < 6; i++) assert.equal(await guard(mkReq(ip), mkRes(), 'ai'), true, `petición ${i + 1}`);
  res = mkRes();
  assert.equal(await guard(mkReq(ip), res, 'ai'), false);
  assert.equal(res.code, 429);
  assert.equal(res.headers['retry-after'], '60');
});

test('tope diario global', async () => {
  process.env.TELAR_VOZ_DAILY_MAX = '3';
  const now = Date.UTC(2026, 10, 7, 12);
  for (let i = 0; i < 3; i++) assert.ok((await countHits('voz', `ip${i}`, now)).global <= 3);
  const h = await countHits('voz', 'ip9', now);
  assert.equal(h.global, 4);
  assert.equal(h.dailyMax, 3);
  delete process.env.TELAR_VOZ_DAILY_MAX;
});

test('acortador: solo enlaces de proyecto de esta Telar', () => {
  const hosts = new Set(['telar.example']);
  assert.equal(isTelarProjectUrl('https://telar.example/#p=H4sIAAAA_-x', hosts), true);
  assert.equal(isTelarProjectUrl('https://phish.example/#p=abc', hosts), false);
  assert.equal(isTelarProjectUrl('https://telar.example/login', hosts), false);
  assert.equal(isTelarProjectUrl('javascript:alert(1)//#p=a', hosts), false);
  assert.equal(isTelarProjectUrl('http://telar.example/#p=abc', hosts), false);
});

// @ts-expect-error módulo JS de las funciones de Vercel
import errores from '../api/errores.js';

test('registro de errores: solo de la propia Telar, recortado, sin guardar nada más', async () => {
  const logs: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  try {
    const ok = mkRes() as Res & { end: () => void };
    ok.end = () => {};
    await errores({ method: 'POST', headers: { host: 'telar.example', 'sec-fetch-site': 'same-origin', 'x-real-ip': '10.9.9.9' }, body: { kind: 'error', message: 'x'.repeat(900), stack: 'a\nb', version: 'abc1234' } }, ok);
    assert.equal(ok.code, 204);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes('"message":"' + 'x'.repeat(400) + '"'));
    const bad = mkRes();
    await errores({ method: 'POST', headers: { host: 'telar.example', origin: 'https://otro.example' }, body: { message: 'hola' } }, bad);
    assert.equal(bad.code, 403);
  } finally { console.error = orig; }
});
