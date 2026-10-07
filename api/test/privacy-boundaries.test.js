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
const SOCIAL_FILES = [
  'summary.js', 'sharing.js', 'challenges.js', 'challenge-service.js', 'friends.js', 'social.js',
  'feed.js', 'feed-service.js', 'notifier.js', 'notify-prefs.js', 'badges.js', 'badge-service.js', 'social-module.js'
];

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
