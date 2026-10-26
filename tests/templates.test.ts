import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../src/lib/templates.ts';
import { splitArrange, parseSeq, isMutedArm, unmuteArm } from '../src/nodes/stepseqCode.ts';
import { splitVariation } from '../src/lib/variation.ts';
import { compileGraph } from '../src/graph/compile.ts';
import { engineAutomation } from '../src/lib/automation.ts';
import { songTotal } from '../src/lib/songClock.ts';

test('7.5 plantilla groove techno: pistas por secciones, editables en la rejilla, y compila', () => {
  const tpl = TEMPLATES.find((t) => t.id === 'groove-techno')!;
  const snap = tpl.build();
  const steps = snap.song!.steps;
  const total = songTotal(steps);
  assert.equal(total, 80);
  assert.ok(Math.abs(snap.cps! * 60 * 4 - 140) < 1e-9);
  const sources = snap.nodes!.filter((n) => n.data.kind === 'source');
  assert.deepEqual(sources.map((n) => n.data.name), ['bombo', 'rumble', 'bajo', 'hats', 'perc', 'top loop', 'transiciones']);
  for (const n of sources) {
    if (Array.isArray(n.data.transitions)) continue;
    const arms = splitArrange(n.data.code ?? '');
    assert.ok(arms, `${n.data.name}: va por secciones`);
    assert.equal(arms!.length, steps.length, `${n.data.name}: un bloque por sección`);
    assert.equal(arms!.reduce((a, x) => a + x.bars, 0), total);
    for (const a of arms!) {
      const code = isMutedArm(a.code) ? unmuteArm(a.code) : a.code;
      const v = splitVariation(code);
      for (const c of v ? [v.base, v.fill] : [code]) {
        const p = parseSeq(c);
        assert.ok(p && !p.complex && p.lanes.length > 0, `${n.data.name}: la rejilla lo lee (${c.slice(0, 60)})`);
      }
    }
  }
  // perc: roll cada 8 en los drops
  const perc = splitArrange(sources.find((n) => n.data.name === 'perc')!.data.code!)!;
  assert.ok(splitVariation(perc[2].code)?.every === 8);
  assert.equal(splitVariation(perc[1].code), null);
  const r = compileGraph(snap.nodes as never[], snap.edges as never[], { songBars: total, keyRoot: 9 });
  assert.equal(r.error, null);
  assert.deepEqual(r.dropped, []);
  assert.match(r.code!, /duck/); // el bombo empuja el sidechain
  assert.match(r.code!, /telar_riser/);
  // a los retornos: hats, perc, top loop y transiciones (cada una con su tira)
  assert.deepEqual(r.channelEqs.map((c) => c.source).sort(), ['src_4', 'src_5', 'src_6', 'src_7']);
  // el barrido del respiro entra como curva del filtro del máster
  const e = engineAutomation(snap.nodes as never[], total);
  assert.ok(e.master.mfilt && e.master.mfilt.some(([, v]) => v > 0.5));
  assert.equal(snap.songKey?.root, 9);
  assert.equal(snap.mode, 'daw');
});
