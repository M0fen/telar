// Biblioteca de ejemplos in-app: los proyectos demo cargables desde el menú (sin
// file-picker), para aprender y arrancar rápido. Se importan los .json del root
// (Vite los empaqueta) y se exponen con un título y una nota corta. (Fase C)
import type { ProjectSnapshot } from './projectStore';
import mastershow from '../../telar-mastershow.json';
import dembowDom from '../../telar-dembow-dominicano.json';
import reggaetonClasico from '../../telar-reggaeton-clasico.json';
import drumandbass from '../../telar-drum-and-bass.json';
import phonkTrap from '../../telar-phonk-trap.json';
import edm from '../../telar-edm-bigroom.json';
import hardtechno from '../../telar-hardtechno-rave.json';
import dancehall from '../../telar-latin-dancehall.json';
import reggaeton from '../../telar-reggaeton-oldschool.json';
import postpunk from '../../telar-postpunk.json';
import berghain from '../../telar-berghain-hardtechno.json';
import dembow from '../../telar-dembow-latino.json';
import phonk from '../../telar-phonk.json';
import schwefelDense from '../../telar-schwefel-harsher-dense.json';
import techno from '../../telar-techno-aleman.json';
import largo from '../../telar-schwefel-largo.json';
import harsher from '../../telar-schwefel-harsher.json';
import darkwave from '../../telar-darkwave-ebm.json';

export interface Demo {
  id: string;
  title: string;
  note: string;
  snap: Partial<ProjectSnapshot>;
}

const as = (x: unknown) => x as Partial<ProjectSnapshot>;

export const DEMOS: Demo[] = [
  { id: 'mastershow', title: '★ Master show', note: 'techno industrial · Berghain · rumble bass ducked · acid 303 · perc metálica euclid · voz IA (editable) · EQ por canal · 134bpm · 50s', snap: as(mastershow) },
  { id: 'dembow-dominicano', title: 'dembow dominicano', note: 'El Alfa · riddim tra-tra · güira/conga/bongo (crate) · 808 glide (EQ) · piano · lead menor · 122bpm', snap: as(dembowDom) },
  { id: 'reggaeton-clasico', title: 'reggaetón clásico', note: 'Daddy Yankee · dembow · piano real (Cm-Ab-Eb-Bb) · pad swpad · 808 glide (EQ) · conga · 92bpm', snap: as(reggaetonClasico) },
  { id: 'drum-and-bass', title: 'drum & bass · jungle', note: 'break AMEN real a PITCH NATURAL (loopAt 4) · two-step 909 · reese bass · sub · pad swpad · piano · 138bpm', snap: as(drumandbass) },
  { id: 'phonk-trap', title: 'phonk / trap', note: 'Memphis · cencerro melódico (808) · 808 distorsión+glide (EQ) · snare lo-fi crate · hats rolls · vinilo · 140bpm', snap: as(phonkTrap) },
  { id: 'edm-bigroom', title: 'EDM big-room', note: 'festival · supersaw pluck · sidechain · 128bpm · 75s', snap: as(edm) },
  { id: 'hardtechno-rave', title: 'hardtechno rave', note: 'kick distorsionado · hoover · acid · 155bpm · 62s', snap: as(hardtechno) },
  { id: 'latin-dancehall', title: 'latin dancehall', note: 'riddim · skank offbeat · swing · 102bpm · 66s', snap: as(dancehall) },
  { id: 'reggaeton-oldschool', title: 'reggaetón old school', note: 'dembow crudo · 808 · lead menor · 92bpm · 73s', snap: as(reggaeton) },
  { id: 'postpunk', title: 'post-punk', note: 'bajo motriz · guitarra chorus · pad · 148bpm · 65s', snap: as(postpunk) },
  { id: 'berghain', title: 'berghain hardtechno', note: 'oscuro · contundente · 150bpm · 51s', snap: as(berghain) },
  { id: 'dembow-latino', title: 'dembow latino', note: 'dancehall/reggaetón · 808 · dembow · 96bpm · 50s', snap: as(dembow) },
  { id: 'phonk', title: 'phonk', note: 'memphis · cencerro 808 · lo-fi · 139bpm · 48s', snap: as(phonk) },
  { id: 'schwefel-dense', title: 'gótico denso', note: 'schwefel+harsher · synth/wt · showcase · 67s', snap: as(schwefelDense) },
  { id: 'techno', title: 'techno alemán', note: 'gótico minimalista · drop · 50s', snap: as(techno) },
  { id: 'largo', title: 'schwefel largo', note: 'darkwave/EBM arreglado · ~2min', snap: as(largo) },
  { id: 'harsher', title: 'schwefel · harsher', note: 'industrial crudo', snap: as(harsher) },
  { id: 'darkwave', title: 'darkwave / EBM', note: 'base oscura de plantilla', snap: as(darkwave) },
];
