// Lista de terceros para «código · licencias · créditos» → public/terceros.json (la lee
// public/licencias.html). Se genera en cada build: siempre coincide con lo que se publica.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pkg = read('package.json');

function repoUrl(p, name) {
  let r = typeof p.repository === 'string' ? p.repository : p.repository?.url;
  if (r) {
    r = r.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://');
    if (/^github:/.test(r)) r = 'https://github.com/' + r.slice(7);
    else if (/^[\w.-]+\/[\w.-]+$/.test(r)) r = 'https://github.com/' + r;
    if (/^https?:\/\//.test(r)) return r;
  }
  return p.homepage || `https://www.npmjs.com/package/${name}`;
}

const NOTES = {
  '@echogarden/rubberband-wasm': 'compilación WASM de Rubber Band Library (Breakfast Quay), que es GPL-2.0-or-later en su origen',
  '@strudel/web': 'motor de patrones y audio (Strudel/superdough)',
};

const deps = Object.keys(pkg.dependencies ?? {}).sort().map((name) => {
  const p = read(`node_modules/${name}/package.json`);
  const license = typeof p.license === 'string' ? p.license : p.license?.type ?? '?';
  return { name, version: p.version, license, url: repoUrl(p, name), ...(NOTES[name] ? { note: NOTES[name] } : {}) };
});

// Lo que no llega por npm: los samples se bajan de sus repositorios al tocar.
const external = [
  { name: 'dough-samples (Strudel)', url: 'https://github.com/felixroos/dough-samples', license: 'cada paquete con la suya', note: 'tidal-drum-machines, piano, Dirt-Samples, EmuSP12, VCSL, mridangam' },
  { name: 'crate', url: 'https://github.com/eddyflux/crate', license: 'ver repositorio' },
  { name: 'switchangel pad · breaks', url: 'https://github.com/switchangel', license: 'ver repositorio' },
  { name: 'clean-breaks', url: 'https://github.com/yaxu/clean-breaks', license: 'ver repositorio' },
];

let commit = process.env.VERCEL_GIT_COMMIT_SHA || '';
if (!commit) { try { commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* sin git */ } }

const out = {
  app: { name: 'Telar', license: pkg.license, source: 'https://github.com/M0fen/telar', commit: commit.slice(0, 12) },
  deps,
  external,
};
writeFileSync('public/terceros.json', JSON.stringify(out, null, 1) + '\n');
console.log(`terceros.json: ${deps.length} dependencias${commit ? ' · ' + commit.slice(0, 7) : ''}`);
