// Strudel REAL en Node para tests de semántica de patrones: @strudel/core importa el REPL de
// kabelsalat (solo navegador); se resuelve a un stub antes de importarlo. Uso:
//   const core = await strudelCore();
import { register } from 'node:module';

let done = false;
export async function strudelCore(): Promise<any> {
  if (!done) {
    register(
      'data:text/javascript,' +
        encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === '@kabelsalat/web') return { url: 'data:text/javascript,export class SalatRepl{}', shortCircuit: true };
  return next(spec, ctx);
}`),
    );
    done = true;
  }
  return import('@strudel/core');
}
