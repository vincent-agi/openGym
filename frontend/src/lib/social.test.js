import { describe, it, expect } from 'vitest'
import {
  HANDLE_RE, DISPLAY_NAME_MAX, normalizeHandle, handleError, displayNameError, canEnableSharing, sharedFields, EMPTY_SOCIAL
} from './social.js'

describe('normalizeHandle', () => {
  it('trims, lowercases and drops a leading @', () => {
    expect(normalizeHandle('  @Lea_Fit ')).toBe('lea_fit')
  })
  it('turns non-strings into an empty handle', () => {
    expect(normalizeHandle(undefined)).toBe('')
    expect(normalizeHandle(12)).toBe('')
  })
})

describe('handleError', () => {
  it('accepts 3-20 chars of a-z, 0-9 and underscore', () => {
    expect(handleError('lea')).toBeNull()
    expect(handleError('Lea_92')).toBeNull()
    expect(handleError('a'.repeat(20))).toBeNull()
  })
  it('explains what is wrong otherwise', () => {
    for (const bad of ['', 'ab', 'a'.repeat(21), 'has space', 'émile', 'dash-ed']) {
      expect(handleError(bad), bad).toEqual(expect.any(String))
    }
  })
  it('agrees with the exported pattern', () => {
    expect(HANDLE_RE.test('lea_92')).toBe(true)
    expect(HANDLE_RE.test('Lea')).toBe(false)
  })
})

describe('displayNameError', () => {
  it('accepts 1-30 characters', () => {
    expect(displayNameError('Léa')).toBeNull()
    expect(displayNameError('x'.repeat(DISPLAY_NAME_MAX))).toBeNull()
  })
  it('rejects empty, blank, too long and control characters', () => {
    for (const bad of ['', '   ', 'x'.repeat(DISPLAY_NAME_MAX + 1), 'bad\u0007']) {
      expect(displayNameError(bad)).toEqual(expect.any(String))
    }
  })
  it('counts characters, not UTF-16 units', () => {
    expect(displayNameError('🏋️'.repeat(10))).toBeNull()
  })
})

describe('canEnableSharing', () => {
  it('needs a valid handle and display name', () => {
    expect(canEnableSharing({ ...EMPTY_SOCIAL })).toBe(false)
    expect(canEnableSharing({ ...EMPTY_SOCIAL, handle: 'lea' })).toBe(false)
    expect(canEnableSharing({ ...EMPTY_SOCIAL, handle: 'lea', displayName: 'Léa' })).toBe(true)
    expect(canEnableSharing({ ...EMPTY_SOCIAL, handle: 'x', displayName: 'Léa' })).toBe(false)
  })
})

describe('sharedFields — what friends will see', () => {
  const base = { ...EMPTY_SOCIAL, enabled: true, handle: 'lea', displayName: 'Léa' }

  it('lists nothing while sharing is off', () => {
    expect(sharedFields({ ...base, enabled: false })).toEqual([])
  })
  it('lists exactly the fields the user chose to share', () => {
    const keys = s => sharedFields(s).map(f => f.key)
    expect(keys(base)).toEqual(['sessions', 'consistency', 'streak'])
    expect(keys({ ...base, share: { ...base.share, prs: true } })).toEqual(['sessions', 'consistency', 'streak', 'prs'])
    expect(keys({ ...base, share: { sessions: false, streak: false, consistency: false, prs: false } })).toEqual([])
  })
  it('never lists anything private, whatever the settings', () => {
    const all = sharedFields({ ...base, share: { sessions: true, streak: true, consistency: true, prs: true } })
    const text = JSON.stringify(all).toLowerCase()
    for (const secret of ['weight', 'nutrition', 'calorie', 'measure', 'effort', 'mobility']) {
      expect(text).not.toContain(secret)
    }
  })
  it('gives each field a placeholder value for the preview card', () => {
    sharedFields(base).forEach(f => expect(f.example).toEqual(expect.any(String)))
  })
})
