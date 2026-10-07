import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static guard for the privacy promise of the social module: the code that builds what friends
 * see must never touch private areas of a user's state. It scans the source (comments removed)
 * so a future change that reads one of them fails here, in review, not in production.
 */
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// The modules that build what friends see. The extension is not part of the name, so the list survives
// the move from JavaScript to TypeScript.
const SOCIAL_MODULES = [
  'summary', 'sharing', 'challenges', 'challenge-service', 'friends', 'social',
  'feed', 'feed-service', 'notifier', 'notify-prefs', 'badges', 'badge-service', 'social-module', 'push-messages'
];
const SOCIAL_FILES = SOCIAL_MODULES.map(name => {
  const file = ['.ts', '.js'].map(ext => name + ext).find(f => fs.existsSync(path.join(dir, f)));
  assert.ok(file, `module ${name} not found`);
  return file;
});

// Fields of the synced state that belong to the user alone.
const PRIVATE_FIELDS = [
  'bodyweight', 'measurements', 'nutrition', 'mobilityLevel', 'disabledLimbs', 'preferredPosture',
  'largeTouchTargets', 'pressureRelief', 'targetW', 'goals', 'exWeights', 'customEx', 'effort', 'rpe', 'rir'
];

const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

for (const file of SOCIAL_FILES) {
  test(`${file} never reads private parts of a user's state`, () => {
    const code = stripComments(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const field of PRIVATE_FIELDS) {
      assert.ok(!new RegExp(`\\b${field}\\b`).test(code), `${file} mentions "${field}"`);
    }
  });
}

test('no social module reads weights, reps, volume or duration of a workout', () => {
  const forbidden = [/\.reps\b/, /\.weight\b/, /\.volume\b/, /\.duration\b/, /\.sets\[[^\]]*\]\.(w|r)\b/];
  for (const file of SOCIAL_FILES) {
    const code = stripComments(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const pattern of forbidden) assert.ok(!pattern.test(code), `${file} reads ${pattern}`);
  }
});
