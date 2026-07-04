// Trazo de onda "HILO ELÉCTRICO" (concepto telar): un núcleo brillante con un halo
// tenue — como un hilo de luz en el telar. Un solo pase con glow (shadowBlur) + remates
// redondeados. Compartido por TODOS los osciloscopios (nodo plegado, secuenciador, deck
// DJ) para coherencia. Minimalista: brilla un poco, sin neón excesivo.
const CORE = 'rgba(150,255,238,0.96)'; // núcleo (un pelín más brillante que el acento)
const GLOW = 'rgba(61,240,208,0.6)';   // halo del acento
const FLAT = 'rgba(61,240,208,0.16)';  // línea base (sin señal)

export function drawWave(ctx: CanvasRenderingContext2D, data: Uint8Array, count: number, W: number, H: number): void {
  const amp = (H / 2) * 0.9;
  const step = W / Math.max(1, count - 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const v = (data[i] - 128) / 128; // -1..1
    const x = i * step;
    const y = H / 2 - v * amp;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.shadowColor = GLOW;
  ctx.shadowBlur = Math.max(2, H * 0.11); // halo proporcional al alto (sutil)
  ctx.strokeStyle = CORE;
  ctx.lineWidth = Math.max(1, H / 15);
  ctx.stroke();
  ctx.shadowBlur = 0; // no arrastrar el glow a otros trazos
}

export function drawFlat(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.shadowBlur = 0;
  ctx.strokeStyle = FLAT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
}
