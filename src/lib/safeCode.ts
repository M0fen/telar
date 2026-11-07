// Verificador ESTÁTICO de código Strudel que viene de fuera (enlace, .json, IA). Nunca lo
// ejecuta: lo parsea con acorn y recorre el árbol. Acepta lo que escribe Telar y lo que se
// escribe en Strudel: llamadas a funciones de Strudel, métodos encadenados, literales,
// aritmética y flechas con cuerpo simple (const/let/if/for/return). Rechaza lo que abre la
// puerta al resto del navegador: identificadores fuera de la lista, `this`, `new`, plantillas
// con etiqueta, funciones normales, propiedades peligrosas (constructor, __proto__, DOM…) y
// accesos `x[…]` cuyo índice no sea siempre un número (un índice numérico nunca llega a
// `constructor`; uno de texto sí: `x['constr'+'uctor']`).
import { parse } from 'acorn';

export interface Verdict { ok: boolean; why?: string }

// ¿Parsea como UNA expresión? Solo sintaxis, sin ejecutar nada (reemplaza a los
// `new Function(...)` que se usaban para validar y que ejecutaban el código).
export function syntaxOk(code: string, max = 8000): boolean {
  if (typeof code !== 'string' || !code.trim() || code.length > max) return false;
  try {
    const ast = parse('(\n' + code + '\n)', { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as AstNode;
    const body = ast.body as AstNode[];
    return body.length === 1 && body[0].type === 'ExpressionStatement';
  } catch {
    return false;
  }
}

// Propiedades que dan acceso a la maquinaria de JS o al DOM. Ni leerlas ni escribirlas.
const BAD_PROPS = new Set([
  'constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__',
  '__lookupSetter__', 'caller', 'callee', 'arguments', 'eval', 'Function', 'globalThis', 'window', 'self',
  'document', 'location', 'top', 'parent', 'opener', 'frames', 'navigator', 'cookie', 'localStorage',
  'sessionStorage', 'indexedDB', 'caches', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'setTimeout', 'setInterval', 'postMessage', 'port', 'audioWorklet', 'addModule', 'ownerDocument',
  'defaultView', 'contentWindow', 'contentDocument', 'getRootNode', 'innerHTML', 'outerHTML',
  'insertAdjacentHTML', 'srcdoc', 'write', 'writeln', 'createElement', 'appendChild', 'append',
  'prepend', 'replaceWith', 'insertBefore', 'setAttribute', 'setAttributeNS', 'querySelector',
  'querySelectorAll', 'getElementById', 'getElementsByTagName', 'getElementsByClassName', 'parentNode',
  'parentElement', 'children', 'childNodes', 'firstChild', 'lastChild', 'nextSibling', 'previousSibling',
  'body', 'head', 'documentElement', 'forms', 'click', 'submit', 'dispatchEvent', 'addEventListener',
  'canvas', 'sendBeacon', 'open', 'showModal', 'requestFullscreen', 'execCommand', 'clipboard',
  'serviceWorker', 'storage', 'credentials', 'geolocation', 'mediaDevices', 'requestMIDIAccess',
]);

// Globales de JS que Telar o Strudel usan, y lo único que se puede tocar de cada uno.
const LIMITED: Record<string, Set<string> | null> = {
  Math: null, // cualquier método (salvo BAD_PROPS)
  Object: new Set(['assign', 'keys', 'values', 'entries', 'fromEntries', 'freeze', 'is']),
  Array: new Set(['isArray', 'from', 'of']),
  Number: new Set(['isFinite', 'isInteger', 'isNaN', 'parseFloat', 'parseInt', 'EPSILON', 'MAX_VALUE', 'MIN_VALUE', 'MAX_SAFE_INTEGER', 'MIN_SAFE_INTEGER']),
  String: new Set(['fromCharCode']),
  JSON: new Set(['parse', 'stringify']),
  Date: new Set(['now']),
};
// `slider(v, min, max)`: el transpilador de Strudel lo cambia por el atajo sliderWithID (un
// patrón constante) — la barra arrastrable del editor (nodes/sliderWidget.ts).
const PLAIN_GLOBALS = new Set(['undefined', 'NaN', 'Infinity', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Boolean', 'slider']);

// Funciones de Strudel que NO deben estar al alcance de código ajeno: evaluar texto, tocar
// el motor o el contexto de audio, cargar módulos o hablar con aparatos MIDI.
const DENY = new Set([
  'evaluate', 'evalScope', 'safeEval', 'repl', 'webaudioRepl', 'initStrudel', 'transpiler', 'transpile',
  'getAudioContext', 'setAudioContext', 'initAudio', 'initAudioOnFirstClick', 'getSuperdoughAudioController',
  'loadOrc', 'loadCsound', 'csound', 'midi', 'enableWebMidi', 'WebMidi', 'midin', 'loadModules', 'setTime',
  'resetGlobalEffects', 'connectToDestination', 'registerProcessor', 'loadWorklets', 'getWorklet',
  // el alcance entero (trae evaluate/repl como propiedades) y el reloj del motor
  'strudelScope', '_strudelLoaded', 'Cyclist', 'controls',
  // audio crudo, módulos de audio, aparatos y red (bajar samples de cualquier URL)
  'samples', 'doughsamples', 'dspWorklet', 'worklet', 'webaudioOutput', 'scheduleAtTime', 'renderPatternAudio',
  'onTriggerSample', 'releaseAudioNode', 'processSampleMap', 'getAudioDevices', 'speak',
]);
// Familias que cambian el motor para toda la sesión (set…/reset…/register…/load…/init…) o
// dan nodos de audio crudos. setcps/setcpm (minúscula) sí se permiten.
const DENY_RE = /^(set[A-Z]|reset|register|load|init|getAudio|getSuperdough|getWorklet|getSample|getLoaded|getOscillator|getVibrato|webaudio)/;
const badProp = (name: string): boolean => BAD_PROPS.has(name) || DENY.has(name);

interface AstNode { type: string; [k: string]: unknown }
type Kind = 'any' | 'num'; // 'num' = variable local que siempre guarda un número

class Scope {
  vars = new Map<string, { kind: Kind; mutable: boolean }>();
  constructor(readonly up: Scope | null) {}
  find(name: string): { kind: Kind; mutable: boolean } | null {
    return this.vars.get(name) ?? this.up?.find(name) ?? null;
  }
}

class Reject extends Error {}

const ARITH = new Set(['-', '*', '/', '%', '**', '|', '&', '^', '<<', '>>', '>>>']);
const NUM_ASSIGN = new Set(['-=', '*=', '/=', '%=', '**=', '|=', '&=', '^=', '<<=', '>>=', '>>>=']);

export function verifyCode(code: string, isGlobal: (name: string) => boolean, max = 200000): Verdict {
  if (typeof code !== 'string' || code.length > max) return { ok: false, why: 'código vacío o demasiado largo' };
  let ast: AstNode;
  try {
    ast = parse('(\n' + code + '\n)', { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as AstNode;
  } catch {
    return { ok: false, why: 'error de sintaxis' };
  }
  const body = ast.body as AstNode[];
  if (body.length !== 1 || body[0].type !== 'ExpressionStatement') return { ok: false, why: 'no es una sola expresión' };
  const no = (why: string): never => {
    throw new Reject(why);
  };

  const propName = (m: AstNode): string | null => {
    const p = m.property as AstNode;
    if (!m.computed && p.type === 'Identifier') return p.name as string;
    if (m.computed && p.type === 'Literal') return String(p.value);
    return null;
  };

  // raíz de una cadena a.b[c].d → su identificador (para saber si es local o global)
  const rootOf = (n: AstNode): AstNode => {
    let x = n;
    while (x.type === 'MemberExpression') x = x.object as AstNode;
    if (x.type === 'ChainExpression') return rootOf(x.expression as AstNode);
    return x;
  };

  // ¿La expresión da SIEMPRE un número? (índices seguros: i, i-1, P.length-1, Math.floor(…))
  const isNum = (n: AstNode | null | undefined, s: Scope): boolean => {
    if (!n) return false;
    switch (n.type) {
      case 'Literal':
        return typeof n.value === 'number';
      case 'Identifier':
        return s.find(n.name as string)?.kind === 'num';
      case 'UnaryExpression':
        return n.operator === '-' || n.operator === '+' || n.operator === '~';
      case 'BinaryExpression':
        return ARITH.has(n.operator as string) || (n.operator === '+' && isNum(n.left as AstNode, s) && isNum(n.right as AstNode, s));
      case 'UpdateExpression':
        return true;
      case 'ConditionalExpression':
        return isNum(n.consequent as AstNode, s) && isNum(n.alternate as AstNode, s);
      case 'MemberExpression':
        return !n.computed && (n.property as AstNode).name === 'length';
      case 'CallExpression': {
        const c = n.callee as AstNode;
        if (c.type === 'Identifier') return c.name === 'Number' || c.name === 'parseInt' || c.name === 'parseFloat';
        return c.type === 'MemberExpression' && (c.object as AstNode).type === 'Identifier' && (c.object as AstNode).name === 'Math' && !s.find('Math');
      }
      default:
        return false;
    }
  };

  const declare = (pat: AstNode, s: Scope, kind: Kind, mutable: boolean): void => {
    switch (pat.type) {
      case 'Identifier':
        if (BAD_PROPS.has(pat.name as string)) no(`nombre reservado: ${pat.name}`);
        s.vars.set(pat.name as string, { kind, mutable });
        return;
      case 'AssignmentPattern':
        expr(pat.right as AstNode, s);
        declare(pat.left as AstNode, s, 'any', mutable);
        return;
      case 'RestElement':
        declare(pat.argument as AstNode, s, 'any', mutable);
        return;
      case 'ArrayPattern':
        for (const e of pat.elements as (AstNode | null)[]) if (e) declare(e, s, 'any', mutable);
        return;
      case 'ObjectPattern':
        for (const p of pat.properties as AstNode[]) {
          if (p.type === 'RestElement') { declare(p.argument as AstNode, s, 'any', mutable); continue; }
          if (p.computed) no('desestructuración calculada');
          const key = p.key as AstNode;
          const name = key.type === 'Identifier' ? (key.name as string) : String(key.value);
          if (badProp(name)) no(`propiedad no permitida: ${name}`);
          declare(p.value as AstNode, s, 'any', mutable);
        }
        return;
      default:
        no(`patrón no permitido: ${pat.type}`);
    }
  };

  const member = (m: AstNode, s: Scope): void => {
    const obj = m.object as AstNode;
    const name = propName(m);
    if (name !== null && badProp(name)) no(`propiedad no permitida: ${name}`);
    if (obj.type === 'Identifier' && !s.find(obj.name as string)) {
      const lim = LIMITED[obj.name as string];
      if (lim !== undefined) {
        if (m.computed || name === null) no(`acceso calculado sobre ${obj.name}`);
        if (lim && !lim.has(name!)) no(`${obj.name}.${name} no está permitido`);
      }
    }
    if (m.computed) {
      const p = m.property as AstNode;
      if (!isNum(p, s)) no('acceso [ ] con un índice que no es un número');
      expr(p, s);
    }
    expr(obj, s);
  };

  const callee = (c: AstNode, s: Scope): void => {
    if (c.type === 'Identifier') {
      const name = c.name as string;
      if (!s.find(name) && !isGlobal(name) && !PLAIN_GLOBALS.has(name) && !(name in LIMITED)) no(`función desconocida: ${name}`);
      return;
    }
    expr(c, s);
  };

  const fn = (f: AstNode, s: Scope, args: AstNode[] = []): void => {
    if (f.async || f.generator) no('función async o generadora');
    const inner = new Scope(s);
    (f.params as AstNode[]).forEach((p, i) => {
      const a = args.at(i);
      // parámetro de una flecha invocada en el acto con un número literal → número (no se reasigna)
      const kind: Kind = p.type === 'Identifier' && a && (a.type === 'Literal' || a.type === 'UnaryExpression') && isNum(a, s) ? 'num' : 'any';
      declare(p, inner, kind, kind !== 'num');
    });
    const b = f.body as AstNode;
    if (b.type === 'BlockStatement') block(b, inner);
    else expr(b, inner);
  };

  function expr(n: AstNode, s: Scope): void {
    switch (n.type) {
      case 'Literal':
        if (n.regex) no('expresión regular');
        return;
      case 'Identifier': {
        const name = n.name as string;
        if (s.find(name) || isGlobal(name) || PLAIN_GLOBALS.has(name) || name in LIMITED) return;
        return no(`nombre desconocido: ${name}`);
      }
      case 'TemplateLiteral':
        for (const e of n.expressions as AstNode[]) expr(e, s);
        return;
      case 'ArrayExpression':
        for (const e of n.elements as (AstNode | null)[]) if (e) expr(e.type === 'SpreadElement' ? (e.argument as AstNode) : e, s);
        return;
      case 'ObjectExpression':
        for (const p of n.properties as AstNode[]) {
          if (p.type === 'SpreadElement') { expr(p.argument as AstNode, s); continue; }
          if (p.computed || p.kind !== 'init' || p.method) no('propiedad calculada, getter o método');
          const key = p.key as AstNode;
          const name = key.type === 'Identifier' ? (key.name as string) : String(key.value);
          if (badProp(name)) no(`propiedad no permitida: ${name}`);
          expr(p.value as AstNode, s);
        }
        return;
      case 'UnaryExpression':
        if (n.operator === 'delete') no('delete');
        return expr(n.argument as AstNode, s);
      case 'BinaryExpression':
      case 'LogicalExpression':
        expr(n.left as AstNode, s);
        return expr(n.right as AstNode, s);
      case 'ConditionalExpression':
        expr(n.test as AstNode, s);
        expr(n.consequent as AstNode, s);
        return expr(n.alternate as AstNode, s);
      case 'SequenceExpression':
        for (const e of n.expressions as AstNode[]) expr(e, s);
        return;
      case 'ChainExpression':
        return expr(n.expression as AstNode, s);
      case 'MemberExpression':
        return member(n, s);
      case 'CallExpression': {
        const args = n.arguments as AstNode[];
        const c = n.callee as AstNode;
        if (c.type === 'ArrowFunctionExpression') fn(c, s, args); // ((P,L)=>…)([[0,1],…], 4)
        else callee(c, s);
        for (const a of args) expr(a.type === 'SpreadElement' ? (a.argument as AstNode) : a, s);
        return;
      }
      case 'ArrowFunctionExpression':
        return fn(n, s);
      case 'AssignmentExpression': {
        const left = n.left as AstNode;
        if (left.type === 'Identifier') {
          const v = s.find(left.name as string);
          if (!v || !v.mutable) no(`asignación a ${left.name}`);
          // una variable numérica sigue siéndolo: solo recibe números
          if (v!.kind === 'num' && !NUM_ASSIGN.has(n.operator as string) && !isNum(n.right as AstNode, s)) no(`${left.name} dejaría de ser un número`);
        } else if (left.type === 'MemberExpression') {
          const root = rootOf(left);
          if (root.type !== 'Identifier' || !s.find(root.name as string)) no('asignación fuera de lo local');
          member(left, s);
        } else no('asignación con patrón');
        return expr(n.right as AstNode, s);
      }
      case 'UpdateExpression': {
        const a = n.argument as AstNode;
        const v = a.type === 'Identifier' ? s.find(a.name as string) : null;
        if (!v || !v.mutable) no('++/-- fuera de lo local');
        return;
      }
      default:
        // NewExpression, ThisExpression, TaggedTemplateExpression, FunctionExpression,
        // ClassExpression, AwaitExpression, YieldExpression, ImportExpression, MetaProperty…
        return no(`no permitido: ${n.type}`);
    }
  }

  function stmt(n: AstNode, s: Scope): void {
    switch (n.type) {
      case 'BlockStatement':
        return block(n, new Scope(s));
      case 'VariableDeclaration':
        if (n.kind === 'var') no('var');
        for (const d of n.declarations as AstNode[]) {
          const init = d.init as AstNode | null;
          if (init) expr(init, s);
          const id = d.id as AstNode;
          const kind: Kind = id.type === 'Identifier' && init && isNum(init, s) ? 'num' : 'any';
          declare(id, s, kind, n.kind === 'let');
        }
        return;
      case 'ReturnStatement':
        if (n.argument) expr(n.argument as AstNode, s);
        return;
      case 'IfStatement':
        expr(n.test as AstNode, s);
        stmt(n.consequent as AstNode, s);
        if (n.alternate) stmt(n.alternate as AstNode, s);
        return;
      case 'ForStatement': {
        const inner = new Scope(s);
        if (n.init) {
          const init = n.init as AstNode;
          if (init.type === 'VariableDeclaration') stmt(init, inner);
          else expr(init, inner);
        }
        if (n.test) expr(n.test as AstNode, inner);
        if (n.update) expr(n.update as AstNode, inner);
        return stmt(n.body as AstNode, inner);
      }
      case 'ExpressionStatement':
        return expr(n.expression as AstNode, s);
      case 'BreakStatement':
      case 'ContinueStatement':
        if (n.label) no('etiquetas');
        return;
      case 'EmptyStatement':
        return;
      default:
        return no(`instrucción no permitida: ${n.type}`);
    }
  }

  function block(b: AstNode, s: Scope): void {
    for (const st of b.body as AstNode[]) stmt(st, s);
  }

  try {
    expr((body[0].expression as AstNode), new Scope(null));
    return { ok: true };
  } catch (e) {
    if (e instanceof Reject) return { ok: false, why: e.message };
    return { ok: false, why: 'no se pudo revisar' };
  }
}

// ¿Este nombre global se puede usar desde código ajeno? Lo que Strudel registró en su
// alcance (funciones, controles, señales), menos lo que toca el motor o evalúa texto.
export function strudelGlobalCheck(scope: Record<string, unknown>): (name: string) => boolean {
  return (name) => !DENY.has(name) && !DENY_RE.test(name) && !BAD_PROPS.has(name) && Object.prototype.hasOwnProperty.call(scope, name);
}
