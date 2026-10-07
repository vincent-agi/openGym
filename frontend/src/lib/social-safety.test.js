import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The names of people are shown to others (display names, handles, challenge titles): they must
// only ever be rendered as text, never as HTML.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const walk = dir => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))

describe('rendering of other people’s text', () => {
  it('never injects HTML anywhere in the app', () => {
    const offenders = walk(root).filter(f => /\.(jsx?|tsx?)$/.test(f) && !f.endsWith('.test.js'))
      .filter(f => /dangerouslySetInnerHTML|innerHTML\s*=/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
