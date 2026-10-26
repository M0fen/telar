// PLANTILLAS DE TEMA (Fase 7.5) — lógica PURA (testeable en Node).
//
// Un tema nuevo que ya arranca armado: pistas típicas ruteadas, canción por secciones y máster
// listo para exportar a −8 LUFS. Todo se edita como lo tuyo (rejillas del secuenciador, bloques
// del DAW, escenas, mezcla); los sonidos son de las cajas de ritmos incluidas, para cambiarlos
// por los de Splice cuando quieras (arrastra el loop sobre la pista o «＋ loop»).
//
// GROOVE TECHNO · 140 BPM · La menor · intro 16 · subida 8 · drop 16 · respiro 8 · drop 2 16 ·
// salida 16 (80 compases):
//   · bombo (909) — dispara el sidechain;
//   · rumble — el sub que rueda entre bombos (3 semicorcheas por pulso), saturado y con sidechain;
//   · bajo — línea corta con filtro que se abre y cierra en cada nota, con sidechain;
//   · hats — cerrados en semicorcheas con acento + abiertos a contratiempo, a la reverb;
//   · perc — clap en 2 y 4, rim y toms sincopados (roll cada 8 en los drops), a la reverb y al eco;
//   · top loop — shaker + perc de la 808, a la reverb;
//   · transiciones — reversos a la subida y al respiro, risers de 8 + impactos a los drops y el
//     barrido del filtro durante el respiro;
//   · retornos: plate corto y eco de corchea con puntillo; máster con glue, punch y algo de swing.
// Ganancias: la suma antes del máster queda con margen (pico ≈ −6 dBFS, como «dejar margen»); el
// volumen de club lo pone ⤓ exportar a −8 LUFS con el limitador del máster.
import type { MasterFx } from '../graph/compile';
import type { NodeData } from '../graph/types';
import type { ProjectSnapshot } from './projectStore';
import type { TransItem } from './transitions';
import type { ExportTarget } from './songExport';
import { muteArm } from '../nodes/stepseqCode';
import { setVariation } from './variation';

type TNode = ProjectSnapshot['nodes'][number];

export interface SongTemplate {
  id: string;
  title: string;
  note: string;
  build: () => Partial<ProjectSnapshot>;
  exportTarget?: ExportTarget; // al cargarla, el objetivo de loudness de ⤓ exportar
}

const SECTIONS = [
  { name: 'intro', bars: 16 },
  { name: 'subida', bars: 8 },
  { name: 'drop', bars: 16 },
  { name: 'respiro', bars: 8 },
  { name: 'drop 2', bars: 16 },
  { name: 'salida', bars: 16 },
];

// una pista por secciones: el patrón donde suena; apagado (.mask(0), se conserva) donde no.
// `vary`: el patrón con variación en esas secciones.
function arranged(pat: string, on: boolean[], vary?: (p: string) => string, varyIn: boolean[] = []): string {
  const arms = SECTIONS.map((s, i) => {
    const p = vary && varyIn[i] ? vary(pat) : pat;
    return `[${s.bars}, ${on[i] ? p : muteArm(p)}]`;
  });
  return `arrange(${arms.join(', ')})`;
}

// 16 pasos con golpes en las posiciones dadas (el resto silencio)
const grid = (snd: string, at: number[]) => Array.from({ length: 16 }, (_, i) => (at.includes(i) ? snd : '~')).join(' ');
const gains = (g: Record<number, number>) => Array.from({ length: 16 }, (_, i) => String(g[i] ?? 1)).join(' ');

function grooveTechno(): Partial<ProjectSnapshot> {
  //                         intro  subida drop   respiro drop2  salida
  const kickOn = /*       */ [true, true, true, false, true, true];
  const rumbleOn = /*     */ [false, true, true, false, true, true];
  const bassOn = /*       */ [false, false, true, false, true, false];
  const hatsOn = /*       */ [true, true, true, true, true, true];
  const percOn = /*       */ [false, true, true, true, true, false];
  const topOn = /*        */ [true, true, true, false, true, true];
  const drops = /*        */ [false, false, true, false, true, false];

  const kick = `s("${grid('bd', [0, 4, 8, 12])}").bank("RolandTR909").shape(0.25)`; // algo saturado: más cuerpo por pico
  const rumble = `note("${grid('a1', [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15])}").s("sine").decay(0.2).sustain(0).shape(0.6).lpf(190)`;
  const bass = `note("~ ~ a2 ~ ~ a2 ~ c3 ~ ~ a2 ~ e3 ~ a2 ~").s("sawtooth").lpf(650).lpenv(2.5).lpdecay(0.12).decay(0.16).sustain(0)`;
  const closed = [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15];
  const hats = `stack(s("${grid('hh', closed)}").gain("${gains(Object.fromEntries(closed.map((i) => [i, i % 4 === 0 ? 0.55 : 0.35])))}"), s("${grid('oh', [2, 6, 10, 14])}")).bank("RolandTR909")`;
  const perc = `stack(s("${grid('cp', [4, 12])}"), s("${grid('rim', [3, 6, 9, 14])}").gain("${gains({ 3: 0.7, 6: 0.5, 9: 0.8, 14: 0.6 })}"), s("${grid('mt', [7])}"), s("${grid('lt', [10])}")).bank("RolandTR909")`;
  const top = `stack(s("${grid('sh', Array.from({ length: 16 }, (_, i) => i))}").gain("${gains(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, i % 4 === 0 ? 0.6 : i % 2 ? 0.35 : 0.45])))}"), s("${grid('perc', [3, 6, 11])}")).bank("RolandTR808")`;

  // compases de canción donde empieza cada sección
  const at: number[] = [];
  SECTIONS.reduce((acc, s) => (at.push(acc), acc + s.bars), 0);
  const [, subida, drop, respiro, drop2] = at;
  const transitions: TransItem[] = [
    { kind: 'reverse', at: subida, bars: 1 },
    { kind: 'riser', at: drop, bars: 8 },
    { kind: 'impact', at: drop, bars: 1 },
    { kind: 'reverse', at: respiro, bars: 1 },
    { kind: 'sweep', at: drop2, bars: 8 },
    { kind: 'riser', at: drop2, bars: 8 },
    { kind: 'impact', at: drop2, bars: 1 },
  ];

  const src = (id: string, y: number, name: string, code: string, extra: Partial<NodeData> = {}): TNode => ({
    id, type: 'source', position: { x: 80, y }, data: { kind: 'source', name, code, ...extra } as NodeData,
  });
  const nodes: TNode[] = [
    src('src_1', 60, 'bombo', arranged(kick, kickOn), { gain: 0.28 }),
    src('src_2', 190, 'rumble', arranged(rumble, rumbleOn), { gain: 0.3 }),
    src('src_3', 320, 'bajo', arranged(bass, bassOn), { gain: 0.5 }),
    src('src_4', 450, 'hats', arranged(hats, hatsOn), { gain: 0.16, sends: { rev: 0.12 } }),
    src('src_5', 580, 'perc', arranged(perc, percOn, (p) => setVariation(p, 8, 'roll'), drops), { gain: 0.15, sends: { rev: 0.22, del: 0.16 } }),
    src('src_6', 710, 'top loop', arranged(top, topOn), { gain: 0.3, sends: { rev: 0.1 } }),
    src('src_7', 840, 'transiciones', 'silence', { gain: 0.25, sends: { rev: 0.18 }, transitions }),
    // sidechain al bombo: el rumble y el bajo bajan con cada golpe
    { id: 'fx_1', type: 'fx', position: { x: 420, y: 200 }, data: { kind: 'fx', opId: 'sidechain', params: { mode: 'duck', trigger: 'src_1', depth: 0.75, attack: 0.08 } } as NodeData },
    { id: 'fx_2', type: 'fx', position: { x: 420, y: 330 }, data: { kind: 'fx', opId: 'sidechain', params: { mode: 'duck', trigger: 'src_1', depth: 0.5, attack: 0.1 } } as NodeData },
    { id: 'out_1', type: 'out', position: { x: 760, y: 420 }, data: { kind: 'out' } as NodeData },
  ];
  const edges: ProjectSnapshot['edges'] = [
    { id: 'e_src_1', source: 'src_1', target: 'out_1' },
    { id: 'e_src_2', source: 'src_2', target: 'fx_1' },
    { id: 'e_fx_1', source: 'fx_1', target: 'out_1' },
    { id: 'e_src_3', source: 'src_3', target: 'fx_2' },
    { id: 'e_fx_2', source: 'fx_2', target: 'out_1' },
    { id: 'e_src_4', source: 'src_4', target: 'out_1' },
    { id: 'e_src_5', source: 'src_5', target: 'out_1' },
    { id: 'e_src_6', source: 'src_6', target: 'out_1' },
    { id: 'e_src_7', source: 'src_7', target: 'out_1' },
  ];
  const master: MasterFx = {
    gain: 1, filter: 0, room: 0, space: '', drive: 0, delay: 0, crush: 0,
    swing: 0.08, humanize: 0.04, // el groove: un poco de swing en las semicorcheas
    limit: 0.35, glue: 0.4, sat: 0.2, width: 1.1, punch: 0.15, eqLow: 0.5, eqMid: -0.5, eqHigh: 1,
    rvSpace: 'ir_plate', rvLevel: 0, rvPre: 15, rvLow: 300, rvHigh: 8000,
    dlNote: 0.75, dlFb: 0.35, dlLow: 400, dlHigh: 5000, dlLevel: -2,
  };
  return {
    nodes,
    edges,
    cps: 140 / 60 / 4,
    beatsPerCycle: 4,
    transpose: 0,
    master,
    mode: 'daw',
    title: 'groove techno',
    songKey: { root: 9, minor: true },
    song: { steps: SECTIONS.map((s, i) => ({ id: `tpl_${i + 1}`, scene: i + 1, bars: s.bars, name: s.name })), loop: false },
    scenes: {},
  };
}

export const TEMPLATES: SongTemplate[] = [
  {
    id: 'groove-techno',
    title: 'groove techno',
    note: '140 BPM · La menor · bombo, rumble y bajo con sidechain · hats, perc y top loop a los retornos · transiciones · 80 compases · exporta a −8 LUFS',
    build: grooveTechno,
    exportTarget: -8,
  },
];
