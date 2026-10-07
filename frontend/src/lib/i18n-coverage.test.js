import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Every string the friends module shows must exist in all eleven locales. English text is the
// key (see lib/i18n.js), so a missing entry silently falls back to English, mid-sentence, with
// nothing failing. This is that failure.
//
// Strings are found where they are written: `t('…')` (translate now), `T('…')` (mark for translation
// and translate later) and `translate('…')` (the translate function passed to a hook).

const src = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOCIAL_FILES = [
  'components/SocialSettings.jsx', 'components/FriendSheets.jsx', 'components/CrewBoard.jsx', 'components/ChallengesCard.jsx',
  'components/FeedCard.jsx', 'components/BadgesCard.jsx', 'components/RecapCard.jsx', 'views/Crew.jsx', 'views/FriendLink.jsx',
  'views/Home.jsx', 'lib/social.js', 'lib/challenges.js', 'lib/recap.js', 'lib/cheers.js', 'lib/badges.js', 'lib/useSocial.js'
]
const CALL = /\b(?:t|T|translate)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g

const keys = new Map()
for (const file of SOCIAL_FILES) {
  for (const m of readFileSync(join(src, file), 'utf8').matchAll(CALL)) {
    const key = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"')
    if (!key.includes('${')) keys.set(key, file)
  }
}

const packs = import.meta.glob('../locales/*.js', { eager: true })
const locales = Object.fromEntries(Object.entries(packs).map(([path, mod]) => [path.match(/(\w+)\.js$/)[1], mod.default]))
const tokens = s => (s.match(/\{\d\}/g) || []).sort().join()

describe('friends module strings', () => {
  it('finds the strings it is supposed to check', () => {
    expect(keys.size).toBeGreaterThan(150)
    expect(Object.keys(locales)).toHaveLength(11)
  })

  for (const [lang, dict] of Object.entries(locales)) {
    it(`${lang}: has every string`, () => {
      const missing = [...keys].filter(([k]) => !(k in dict)).map(([k, f]) => `${f}: ${k}`)
      expect(missing).toEqual([])
    })

    it(`${lang}: keeps every {0}-style placeholder`, () => {
      const broken = [...keys.keys()].filter(k => k in dict && tokens(dict[k]) !== tokens(k))
      expect(broken).toEqual([])
    })

    it(`${lang}: translates long sentences instead of repeating the English`, () => {
      const same = [...keys.keys()].filter(k => k.length > 30 && dict[k] === k)
      expect(same).toEqual([])
    })
  }
})
