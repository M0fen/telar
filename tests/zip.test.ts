// ZIP mínimo para los stems (Modo DAW, Fase 3.4): estructura válida y CRC correcto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zcrc } from 'node:zlib';
import { makeZip, crc32 } from '../src/lib/zip.ts';

test('3.4 CRC-32 igual al de zlib', () => {
  const d = new TextEncoder().encode('telar stems ñ 123');
  assert.equal(crc32(d), zcrc(d));
});

test('3.4 ZIP «store»: cabeceras, directorio central, nombres UTF-8 y datos intactos', async () => {
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new Blob([new Uint8Array(1000).fill(7)]);
  const zip = new Uint8Array(await (await makeZip([{ name: '01-bombo.wav', data: a }, { name: '02-aves_silbido ñ.wav', data: b }], new Date(2026, 9, 25, 12, 0, 0))).arrayBuffer());
  const dv = new DataView(zip.buffer);
  // fin del directorio central al final
  const eocd = zip.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 10, true), 2);
  const cdOff = dv.getUint32(eocd + 16, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  assert.equal(cdOff + cdSize, eocd);
  // primera entrada local
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  const n1 = dv.getUint16(26, true);
  assert.equal(new TextDecoder().decode(zip.slice(30, 30 + n1)), '01-bombo.wav');
  assert.deepEqual(Array.from(zip.slice(30 + n1, 30 + n1 + 5)), [1, 2, 3, 4, 5]);
  assert.equal(dv.getUint32(14, true), zcrc(a));
  // segunda entrada: por el offset del directorio central
  const e2 = cdOff + 46 + n1;
  assert.equal(dv.getUint32(e2, true), 0x02014b50);
  const off2 = dv.getUint32(e2 + 42, true);
  const n2 = dv.getUint16(off2 + 26, true);
  assert.equal(new TextDecoder().decode(zip.slice(off2 + 30, off2 + 30 + n2)), '02-aves_silbido ñ.wav');
  assert.equal(dv.getUint32(off2 + 18, true), 1000);
  assert.equal(dv.getUint32(off2 + 14, true), zcrc(new Uint8Array(1000).fill(7)));
});
