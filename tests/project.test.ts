// Canción y escenas dentro del proyecto (Fase 0.1): viajan en el snapshot, se sanean al
// cargar, faltar = vacías y la migración desde las claves viejas ocurre una sola vez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flushProjectSave,
  projectExtras,
  saveProjectDebounced,
  sanitizeScenes,
  sanitizeSong,
  startupScenes,
  startupSong,
  type ProjectSnapshot,
} from '../src/lib/projectStore.ts';
import { useSongStore } from '../src/store/useSongStore.ts';
import type { Scene } from '../src/store/useScenesStore.ts';

const song = {
  steps: [
    { id: 'st_a', scene: 1, bars: 8 },
    { id: 'st_b', scene: 3, bars: 16 },
    { id: 'st_c', scene: 2, bars: 4 },
  ],
  loop: false,
};
const scenes: Record<number, Scene> = {
  1: { slot: 1, name: 'intro', state: { src_1: { mute: false, solo: false, gain: 0.8, chFilter: -0.4 } }, master: { filter: -0.3, room: 0.2 }, savedAt: 1792000000000 },
  3: { slot: 3, name: 'drop', state: { src_1: { mute: false, solo: false, params: { cutoff: 1200 } }, src_2: { mute: true, solo: false } }, savedAt: 1792000000500 },
};

// lo que hace exportar → importar: JSON de ida y vuelta
const roundTrip = (snap: Partial<ProjectSnapshot>) => JSON.parse(JSON.stringify(snap)) as Partial<ProjectSnapshot>;

test('snapshot → JSON → snapshot: la canción y las escenas vuelven idénticas', () => {
  const x = projectExtras(roundTrip({ cps: 0.5, song, scenes }));
  assert.deepEqual(x.song, song);
  assert.deepEqual(x.scenes, scenes);
});

test('cargar un snapshot SIN canción ni escenas las deja vacías (eran de otro grafo)', () => {
  const x = projectExtras(roundTrip({ cps: 0.5, nodes: [], edges: [] }));
  assert.deepEqual(x.song, { steps: [], loop: true });
  assert.deepEqual(x.scenes, {});
  assert.deepEqual(projectExtras(null), { song: { steps: [], loop: true }, scenes: {} });
});

test('canción del store: replace → leer = la misma canción, y detiene el modo canción', () => {
  useSongStore.getState().setPlaying(true);
  useSongStore.getState().setIndex(2);
  useSongStore.getState().replace(projectExtras(roundTrip({ song })).song);
  const st = useSongStore.getState();
  assert.deepEqual({ steps: st.steps, loop: st.loop }, song);
  assert.equal(st.playing, false);
  assert.equal(st.index, 0);
  useSongStore.getState().replace(projectExtras(null).song);
  assert.deepEqual(useSongStore.getState().steps, []);
});

test('saneo de la canción: escena 1–9, 1–64 compases, ids únicos, basura fuera', () => {
  const s = sanitizeSong({
    steps: [{ id: 'a', scene: 12, bars: 0 }, { id: 'a', scene: 2.4, bars: 300 }, null, { scene: 'x', bars: 4 }, { bars: 2 }, 'hola'],
  });
  assert.ok(s);
  assert.deepEqual(s.steps.map((x) => [x.scene, x.bars]), [[9, 1], [2, 64]]);
  assert.equal(new Set(s.steps.map((x) => x.id)).size, 2);
  assert.equal(s.loop, true);
  assert.equal(sanitizeSong({ steps: 'no' }), null);
  assert.equal(sanitizeSong(undefined), null);
});

test('saneo de escenas: solo 1–9 con estado; el máster fuera de rango vuelve a neutro', () => {
  const sc = sanitizeScenes({
    0: { state: {} },
    4: { name: '', state: { n: { mute: true } }, master: { filter: -3, room: 0.3 } },
    10: { state: {} },
    5: { name: 'sin estado' },
    x: { state: {} },
  });
  assert.ok(sc);
  assert.deepEqual(Object.keys(sc), ['4']);
  assert.equal(sc[4].slot, 4);
  assert.equal(sc[4].name, 'escena 4');
  assert.equal(sc[4].master?.filter, 0); // un −3 de otra IA dejaría muda la canción
  assert.equal(sc[4].master?.room, 0.3);
  assert.equal(sanitizeScenes([1, 2]), null);
});

test('migración: un proyecto viejo adopta las claves viejas UNA vez; uno nuevo nunca', () => {
  const legacySong = JSON.stringify(song);
  const legacyScenes = JSON.stringify(scenes);
  // proyecto de antes (sin song/scenes) → adopta las de telar.song.v1 / telar.scenes.v1
  assert.deepEqual(startupSong({ cps: 0.5 }, legacySong), song);
  assert.deepEqual(startupScenes({ cps: 0.5 }, legacyScenes), scenes);
  assert.deepEqual(startupSong(null, legacySong), song);
  // proyecto ya guardado con canción vacía → NO revive la vieja
  assert.deepEqual(startupSong({ song: { steps: [], loop: true } }, legacySong), { steps: [], loop: true });
  assert.deepEqual(startupScenes({ scenes: {} }, legacyScenes), {});
  // proyecto con las suyas → las suyas
  assert.deepEqual(startupSong({ song: { steps: [song.steps[0]], loop: true } }, legacySong).steps, [song.steps[0]]);
  // sin nada, o clave vieja rota → vacías
  assert.deepEqual(startupSong(null, null), { steps: [], loop: true });
  assert.deepEqual(startupScenes(null, '{roto'), {});
});

test('Fase 2.1: el nombre propio de una sección (marcador del DAW) viaja en el proyecto', async () => {
  const { sanitizeSong } = await import('../src/lib/projectStore.ts');
  const s = sanitizeSong({ steps: [{ id: 'a', scene: 1, bars: 8, name: '  drop  ' }, { id: 'b', scene: 2, bars: 8, name: '' }, { id: 'c', scene: 2, bars: 8, name: 7 }], loop: true })!;
  assert.deepEqual(s.steps.map((x) => x.name), ['drop', undefined, undefined]);
});

test('autoguardado: lo pendiente se guarda YA al cerrar u ocultar la pestaña (flush), una sola vez', () => {
  const store = new Map<string, string>();
  let writes = 0;
  const g = globalThis as unknown as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { writes++; store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  try {
    const a = { cps: 0.5, song } as unknown as ProjectSnapshot;
    const b = { cps: 0.6, song } as unknown as ProjectSnapshot;
    saveProjectDebounced(a);
    saveProjectDebounced(b); // el último gana
    assert.equal(writes, 0, 'aún esperando el medio segundo');
    flushProjectSave();
    assert.equal(writes, 1);
    assert.equal(JSON.parse(store.get('telar.project.v1') as string).cps, 0.6);
    flushProjectSave(); // nada pendiente → no reescribe
    assert.equal(writes, 1);
  } finally {
    g.localStorage = prev;
  }
});
