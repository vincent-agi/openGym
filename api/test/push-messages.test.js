import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUSH_LANGS, normalizeLang, pushText, MESSAGE_KEYS } from '../push-messages.js';
import { wording } from '../notifier.js';

const SAMPLE = { names: ['Léa'], name: 'Léa', emoji: '🔥', title: 'Automne', stage: 'half' };
const KINDS = ['friendSession', 'cheerReceived', 'challengeInvite', 'challengeMilestone', 'challengeEnded'];

test('English and French are available, English being the fallback', () => {
  assert.deepEqual(PUSH_LANGS, ['en', 'fr']);
});

test('normalizeLang keeps the language part, in lower case, and falls back to English', () => {
  assert.equal(normalizeLang('fr'), 'fr');
  assert.equal(normalizeLang('fr-FR'), 'fr');
  assert.equal(normalizeLang('FR_ca'), 'fr');
  assert.equal(normalizeLang('de'), 'en');          // not translated yet
  for (const bad of [undefined, null, '', 42, '12', {}]) assert.equal(normalizeLang(bad), 'en');
});

test('every language defines every message', () => {
  for (const lang of PUSH_LANGS) {
    for (const key of MESSAGE_KEYS) {
      const m = pushText(lang, key, { name: 'N', names: 'N', n: 3, emoji: '🔥', title: 'T' });
      assert.ok(m.title && m.body, `${lang}.${key}`);
    }
  }
});

test('placeholders are all filled, in every language', () => {
  for (const lang of PUSH_LANGS) {
    for (const key of MESSAGE_KEYS) {
      const m = pushText(lang, key, { name: 'N', n: 3, emoji: '🔥', title: 'T' });
      assert.ok(!/[{}]/.test(m.title + m.body), `${lang}.${key}: ${m.title} / ${m.body}`);
    }
  }
});

test('a missing language or key falls back to English instead of breaking', () => {
  assert.equal(pushText('xx', 'cheerReceived', { name: 'Ana', emoji: '🔥' }).title, 'Ana cheered your session 🔥');
  assert.throws(() => pushText('en', 'nope', {}));
});

test('wording follows the language and keeps the deep link and tag', () => {
  for (const kind of KINDS) {
    const en = wording(kind, SAMPLE, 'en');
    const fr = wording(kind, SAMPLE, 'fr');
    assert.notEqual(fr.title, en.title, kind);
    assert.equal(fr.url, '#/crew');
    assert.equal(fr.tag, en.tag);
  }
});

test('French reads naturally: gender-neutral, addressing the user politely', () => {
  assert.equal(wording('cheerReceived', SAMPLE, 'fr').title, 'Léa a encouragé votre séance 🔥');
  assert.equal(wording('friendSession', { names: ['Léa'] }, 'fr').title, 'Léa a terminé une séance');
  assert.equal(wording('friendSession', { names: ['Léa', 'Marc', 'Zoé'] }, 'fr').title, '3 amis se sont entraînés aujourd’hui');
  assert.equal(wording('challengeInvite', SAMPLE, 'fr').title, 'Léa vous invite à « Automne »');
  assert.equal(wording('challengeMilestone', SAMPLE, 'fr').title, 'À mi-parcours !');
  assert.equal(wording('challengeMilestone', { ...SAMPLE, stage: 'target' }, 'fr').title, 'Objectif atteint 🎉');
  assert.equal(wording('challengeEnded', SAMPLE, 'fr').title, '« Automne » est terminé');
});

test('French messages are as encouraging as the English ones: no ranks, comparisons or reproach', () => {
  const bad = ['en retard', 'battu', 'perdu', 'dernier', 'classement', 'rang', 'paresse', 'raté', 'manqué', 'pire'];
  for (const kind of KINDS) {
    for (const stage of ['half', 'target']) {
      const m = wording(kind, { ...SAMPLE, stage, names: ['A', 'B'] }, 'fr');
      const text = `${m.title} ${m.body}`.toLowerCase();
      for (const word of bad) assert.ok(!text.includes(word), `${word} in "${text}"`);
    }
  }
});

test('the default language is English, as before', () => {
  assert.equal(wording('cheerReceived', SAMPLE).title, 'Léa cheered your session 🔥');
});
