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
    // Kit pensado para la REJILLA: segmentos de 16 pasos de igual longitud (nada de
    // arrange/struct → todo editable), niveles con .mul(gain(x)) (no pisan acentos) y
    // percusión de packs SIN banco (bankExempt: el prefijo la silenciaría).
    genre: 'latin dancehall',
    items: [
      {
        label: 'riddim dembow (16)',
        name: 'riddim',
        // kick medio-tiempo (1 y 9) + caja en el patrón dembow (4·7·12·15) + hats
        // discretos en corcheas. TODO editable en la rejilla, paso a paso.
        code: 'stack(s("bd ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~ ~ ~"), s("~ ~ ~ sd ~ ~ sd ~ ~ ~ ~ sd ~ ~ sd ~").mul(gain(0.85)), s("hh ~ hh ~ hh ~ hh ~ hh ~ hh ~ hh ~ hh ~").mul(gain(0.4))).bank("RolandTR808")',
      },
      {
        label: 'percusión viva',
        name: 'perc latina',
        // conga a contratiempo + shaker en semicorcheas (crate, sin banco): la capa
        // que separa amateur de pro. Menos es más: deja el 1 al bombo.
        code: 'stack(s("~ ~ crate_conga ~ ~ ~ ~ crate_conga ~ ~ crate_conga ~ ~ ~ ~ ~").mul(gain(0.55)), s("crate_sh*16").mul(gain(0.3)))',
      },
      {
        label: 'skank offbeat (bubble)',
        name: 'skank',
        // tríadas menores SOLO en el offbeat + eco dub (delaysync 3/16 del motor).
        code: 'note("~ [c4,eb4,g4] ~ [c4,eb4,g4] ~ [c4,eb4,g4] ~ [c4,eb4,g4]").s("square").lpf(1500).lpq(4).attack(0.005).decay(0.12).sustain(0).delay(0.25).delayfeedback(0.5).room(0.15).mul(gain(0.5))',
      },
      {
        label: 'bajo dancehall',
        name: 'bajo',
        // sub redondo que encastra con el kick (1 con él, respuestas en los huecos).
        code: 'note("c2 ~ ~ c2 ~ ~ g1 ~").s("sine").lpf(600).shape(0.2)',
      },
    ],
  },
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
