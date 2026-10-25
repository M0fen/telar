// ZIP mínimo SIN compresión (método «store») y sin dependencias — para entregar los stems
// (Modo DAW, Fase 3.4). Los WAV ya ocupan lo que ocupan: comprimirlos casi no ahorra y costaría
// CPU en el hilo principal. Las partes se arman como Blob (el navegador puede mantenerlas fuera
// de la memoria de JS); cada archivo se lee una vez para su CRC-32. Formato ZIP clásico (sin
// ZIP64): cada archivo y el total < 4 GB. Nombres en UTF-8 (bit 11).
let table: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
export function crc32(data: Uint8Array, crc = 0): number {
  const t = crcTable();
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export interface ZipEntry {
  name: string;
  data: Blob | Uint8Array;
}

export async function makeZip(files: ZipEntry[], when = new Date()): Promise<Blob> {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const bytes = f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
    const size = bytes.length;
    if (size >= 0xffffffff || offset >= 0xffffffff) throw new Error('ZIP demasiado grande (más de 4 GB)');
    const crc = crc32(bytes);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); // firma de cabecera local
    lh.setUint16(4, 20, true); // versión mínima
    lh.setUint16(6, 0x0800, true); // nombre en UTF-8
    lh.setUint16(8, 0, true); // store
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name as BlobPart, (f.data instanceof Uint8Array ? bytes : f.data) as BlobPart);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); // firma del directorio central
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    const entry = new Uint8Array(46 + name.length);
    entry.set(new Uint8Array(ch.buffer), 0);
    entry.set(name, 46);
    central.push(entry);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // fin del directorio central
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), new Uint8Array(end.buffer)], { type: 'application/zip' });
}
