import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserShort, feedbackMessage, whatsappUrl } from '../src/lib/feedback';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE = CHROME + ' Edg/141.0.0.0';

test('navegador en corto', () => {
  assert.equal(browserShort(CHROME), 'Chrome 141 · Windows');
  assert.equal(browserShort(EDGE), 'Edge 141 · Windows');
});

test('el mensaje lleva modo, texto, nombre, versión y navegador (nada del proyecto)', () => {
  const m = feedbackMessage({ mode: 'dj', text: ' el tema B tartamudea al entrar ', name: 'Ana', version: '124b6cf9a1', ua: CHROME });
  assert.equal(m, 'Telar · opinión (DJ)\n\nel tema B tartamudea al entrar\n\n— Ana\n\nversión 124b6cf · Chrome 141 · Windows');
  assert.ok(whatsappUrl(m).startsWith('https://wa.me/573122143556?text=Telar'));
});
