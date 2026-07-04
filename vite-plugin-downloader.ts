import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Connect, Plugin, ViteDevServer, PreviewServer } from 'vite';

// Descargador de audio de YouTube. El navegador NO puede bajar de YouTube por sí
// solo (CORS + protecciones de YouTube), así que exponemos un endpoint en el
// servidor de Vite que invoca `yt-dlp` en la máquina local y guarda el audio en
// public/samples/yt/ — desde ahí Strudel lo carga como sample.
//
// Bajamos `bestaudio` en su contenedor nativo (m4a/opus/webm) SIN reconvertir:
// es la máxima calidad posible (sin recodificar) y NO requiere ffmpeg. El
// navegador decodifica esos formatos con decodeAudioData sin problema.
//
// Único requisito en el sistema: `yt-dlp` (un solo ejecutable) en el PATH, o
// colocado en ./bin del proyecto.
//   Windows:  winget install yt-dlp.yt-dlp   (o)  pip install -U yt-dlp

const OUT_DIR = resolve(process.cwd(), 'public', 'samples', 'yt');
const MANIFEST = resolve(OUT_DIR, 'index.json');
const BIN_DIR = resolve(process.cwd(), 'bin');

// Resuelve el ejecutable de yt-dlp: prefiere ./bin (binario portable) y si no
// está, lo busca en el PATH del sistema.
function ytBin(): string {
  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const local = resolve(BIN_DIR, exe);
  return existsSync(local) ? local : exe;
}

interface Track {
  id: string;
  name: string; // identificador de sample válido (yt_<id>)
  title: string;
  file: string; // ruta servible, ej. /samples/yt/<id>.m4a
  createdAt: number;
}

function ensureDir() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
}

function readManifest(): Track[] {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Track[];
  } catch {
    return [];
  }
}

function writeManifest(tracks: Track[]) {
  ensureDir();
  writeFileSync(MANIFEST, JSON.stringify(tracks, null, 2), 'utf8');
}

// Reconcilia el manifiesto con los audios realmente presentes en disco.
function listTracks(): Track[] {
  ensureDir();
  const present = new Set(readdirSync(OUT_DIR));
  return readManifest().filter((t) => present.has(t.file.split('/').pop() ?? ''));
}

const YT_RE = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;
const sampleName = (id: string) => `yt_${id.replace(/[^a-zA-Z0-9]/g, '')}`;

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => res(data));
  });
}

// Cuerpo binario crudo (para audio grabado): NO concatenar como string (corrompe).
function readRaw(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks)));
  });
}

function sendJSON(res: import('node:http').ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// Ejecuta yt-dlp; resuelve con {id,ext,title} o rechaza con un mensaje legible.
function ytDownload(url: string): Promise<{ id: string; ext: string; title: string }> {
  return new Promise((res, rej) => {
    ensureDir();
    // bestaudio en contenedor nativo, sin recodificar (máxima calidad, sin ffmpeg).
    // --print after_move imprime id, extensión final y título separados por TAB.
    const args = [
      // máxima calidad de audio disponible, sin recodificar (suele ser opus ~160k
      // o m4a/AAC). decodeAudioData lo reproduce en Chrome/Edge/Firefox (Windows);
      // para descargar al PC es la mejor calidad posible.
      '-f', 'bestaudio/best',
      '--no-playlist',
      '--no-progress',
      '--print', 'after_move:%(id)s\t%(ext)s\t%(title)s',
      '-o', `${OUT_DIR.replace(/\\/g, '/')}/%(id)s.%(ext)s`,
      url,
    ];
    let proc;
    try {
      proc = spawn(ytBin(), args, { shell: false });
    } catch (e) {
      rej(new Error(`no se pudo ejecutar yt-dlp: ${(e as Error).message}`));
      return;
    }
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', (e) =>
      rej(
        new Error(
          `yt-dlp no está instalado o no está en el PATH (${e.message}). ` +
            `Instálalo con: winget install yt-dlp.yt-dlp`
        )
      )
    );
    proc.on('close', (codeNum) => {
      if (codeNum !== 0) {
        rej(new Error(err.trim().split('\n').slice(-3).join(' ') || `yt-dlp salió con código ${codeNum}`));
        return;
      }
      const line = out.trim().split('\n').filter(Boolean).pop() ?? '';
      const [id, ext, ...rest] = line.split('\t');
      if (!id || !ext) {
        rej(new Error('yt-dlp no devolvió id/extensión del video'));
        return;
      }
      res({ id, ext, title: rest.join('\t') || id });
    });
  });
}

function makeMiddleware() {
  return async (
    req: Connect.IncomingMessage,
    res: import('node:http').ServerResponse,
    next: Connect.NextFunction
  ) => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/yt/') && !url.startsWith('/api/rec/')) return next();

    if (req.method === 'GET' && url.startsWith('/api/yt/list')) {
      sendJSON(res, 200, { ok: true, tracks: listTracks() });
      return;
    }

    // Guarda una grabación de micrófono (webm crudo en el body) como sample.
    if (req.method === 'POST' && url.startsWith('/api/rec/save')) {
      try {
        ensureDir();
        const title = decodeURIComponent(new URL(url, 'http://x').searchParams.get('title') || 'grabación');
        const buf = await readRaw(req);
        if (!buf.length) {
          sendJSON(res, 400, { ok: false, error: 'grabación vacía' });
          return;
        }
        const id = `rec_${Date.now()}`;
        const fileName = `${id}.webm`;
        writeFileSync(resolve(OUT_DIR, fileName), buf);
        const track: Track = {
          id,
          name: `voz_${id.replace(/[^a-zA-Z0-9]/g, '')}`,
          title,
          file: `/samples/yt/${fileName}`,
          createdAt: Date.now(),
        };
        const tracks = listTracks().filter((t) => t.id !== id);
        tracks.unshift(track);
        writeManifest(tracks);
        sendJSON(res, 200, { ok: true, track });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: (e as Error).message });
      }
      return;
    }

    if (req.method === 'POST' && url.startsWith('/api/yt/delete')) {
      try {
        const { id } = JSON.parse((await readBody(req)) || '{}') as { id?: string };
        const tracks = listTracks();
        const target = tracks.find((t) => t.id === id);
        if (target) {
          const file = resolve(OUT_DIR, target.file.split('/').pop() ?? '');
          if (existsSync(file)) rmSync(file);
        }
        writeManifest(tracks.filter((t) => t.id !== id));
        sendJSON(res, 200, { ok: true, tracks: listTracks() });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: (e as Error).message });
      }
      return;
    }

    if (req.method === 'POST' && url.startsWith('/api/yt/download')) {
      try {
        const { url: link } = JSON.parse((await readBody(req)) || '{}') as { url?: string };
        if (!link || !YT_RE.test(link)) {
          sendJSON(res, 400, { ok: false, error: 'enlace de YouTube no válido' });
          return;
        }
        const { id, ext, title } = await ytDownload(link);
        const track: Track = {
          id,
          name: sampleName(id),
          title,
          file: `/samples/yt/${id}.${ext}`,
          createdAt: Date.now(),
        };
        const tracks = listTracks().filter((t) => t.id !== id);
        tracks.unshift(track);
        writeManifest(tracks);
        sendJSON(res, 200, { ok: true, track });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: (e as Error).message });
      }
      return;
    }

    next();
  };
}

export function telarDownloader(): Plugin {
  return {
    name: 'telar-downloader',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(makeMiddleware());
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(makeMiddleware());
    },
  };
}
