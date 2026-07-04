// Kits de instrumentos urbanos: patrones-fuente listos para soltar y empezar a
// hacer Phonk y Dancehall/reggaetón (priorizando el dembow latino). Cada item es
// el código de un Source; se añade al grafo con un clic (como los patrones
// guardados). Usan el banco RolandTR808 (cargado en el prebake) — el cencerro
// (cb) afinado con note() es la firma del Phonk; los samples se afinan con note().
export interface KitItem {
  label: string;
  code: string;
  name: string;
}
export interface KitGroup {
  genre: string;
  items: KitItem[];
}

export const URBAN_KITS: KitGroup[] = [
  {
    genre: 'dancehall / reggaetón',
    items: [
      {
        label: 'dembow riddim',
        name: 'dembow',
        // groove dembow clásico: bombo en 1 y 3 + caja en el patrón "dem-bow"
        // (4·7·12·15) + hats. La base del reggaetón/dancehall latino.
        code: 'stack(\n  s("bd ~ bd ~").bank("RolandTR808"),\n  s("sd").struct("~ ~ ~ x ~ ~ x ~ ~ ~ ~ x ~ ~ x ~").bank("RolandTR808").gain(0.85),\n  s("hh*8").bank("RolandTR808").gain(0.35)\n)',
      },
      {
        label: 'bajo reggaetón',
        name: 'bajo regg',
        code: 'note("c1 ~ c1 ~ g0 ~ c1 ~").s("sine").lpf(480).shape(0.25)',
      },
      {
        label: 'stab dembow',
        name: 'stab',
        code: 'note("[c3,eb3,g3] ~ ~ [c3,eb3,g3] ~ ~ ~ ~").s("square").lpf(1600).lpq(6).shape(0.2).room(0.2)',
      },
      {
        label: 'melodía menor',
        name: 'melodía',
        code: 'note("c5 eb5 g5 ~ bb4 ~ g4 ~").s("triangle").decay(0.2).sustain(0).room(0.25).gain(0.5)',
      },
    ],
  },
  {
    genre: 'phonk',
    items: [
      {
        label: 'cencerro (cowbell)',
        name: 'cowbell',
        // la firma del Phonk: cencerro 808 AFINADO con note() (Do menor).
        code: 'note("c5 c5 eb5 c5 g4 c5 bb4 g4").s("cb").bank("RolandTR808").gain(0.6)',
      },
      {
        label: '808 distorsionado',
        name: '808 dist',
        code: 'note("c1 ~ ~ eb1 ~ ~ g0 ~").s("sawtooth").lpf(620).lpq(3).shape(0.5).coarse(2)',
      },
      {
        label: 'hats trap',
        name: 'hats trap',
        code: 's("hh*8 hh*16").bank("RolandTR808").gain(0.4)',
      },
      {
        label: 'bombo phonk',
        name: 'bombo',
        code: 's("bd ~ ~ ~ bd ~ ~ ~").bank("RolandTR808").shape(0.45)',
      },
    ],
  },
];
