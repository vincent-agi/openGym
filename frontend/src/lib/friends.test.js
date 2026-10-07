import { describe, it, expect } from 'vitest'
import { friendLink, extractFriendCode, addRequestBodies, rememberPendingCode, takePendingCode } from './friends.js'

describe('friendLink', () => {
  it('builds a hash-router link to the friend route', () => {
    expect(friendLink('ABCDEFGHJK', 'https://gym.example.com/')).toBe('https://gym.example.com/#/friend/ABCDEFGHJK')
  })
  it('does not double the slash of the base', () => {
    expect(friendLink('ABCDEFGHJK', 'https://gym.example.com')).toBe('https://gym.example.com/#/friend/ABCDEFGHJK')
  })
})

describe('extractFriendCode', () => {
  it('accepts a bare code in any case, with spaces or dashes', () => {
    expect(extractFriendCode('abcdefghjk')).toBe('ABCDEFGHJK')
    expect(extractFriendCode(' ABCDE-FGHJK ')).toBe('ABCDEFGHJK')
  })
  it('pulls the code out of a pasted link', () => {
    expect(extractFriendCode('https://gym.example.com/#/friend/abcdefghjk')).toBe('ABCDEFGHJK')
  })
  it('rejects anything that cannot be a code', () => {
    for (const bad of ['', 'short', 'ABCDEFGHJ0', 'ABCDEFGHJKL', '@lea_fit', null, undefined]) {
      expect(extractFriendCode(bad), String(bad)).toBeNull()
    }
  })
})

describe('addRequestBodies', () => {
  it('treats @handle as a handle only', () => {
    expect(addRequestBodies('@Lea_Fit')).toEqual([{ handle: 'lea_fit' }])
  })
  it('treats a link as a code only', () => {
    expect(addRequestBodies('https://x.io/#/friend/ABCDEFGHJK')).toEqual([{ code: 'ABCDEFGHJK' }])
  })
  it('tries a handle as a code first, then as a handle, when the text fits both', () => {
    expect(addRequestBodies('hankreeves')).toEqual([{ code: 'HANKREEVES' }, { handle: 'hankreeves' }])
  })
  it('falls back to a handle for text that cannot be a code', () => {
    expect(addRequestBodies('lea_92')).toEqual([{ handle: 'lea_92' }])
  })
  it('returns nothing for empty or invalid input', () => {
    expect(addRequestBodies('')).toEqual([])
    expect(addRequestBodies('  ')).toEqual([])
    expect(addRequestBodies('no way!')).toEqual([])
  })
})

describe('pending friend code', () => {
  const memory = () => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = v }, removeItem: k => { delete m[k] } } }

  it('is remembered once and consumed on read', () => {
    const s = memory()
    rememberPendingCode('ABCDEFGHJK', s)
    expect(takePendingCode(s)).toBe('ABCDEFGHJK')
    expect(takePendingCode(s)).toBeNull()
  })
  it('ignores values that are not codes', () => {
    const s = memory()
    rememberPendingCode('nope', s)
    expect(takePendingCode(s)).toBeNull()
  })
  it('survives storage that throws', () => {
    const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
    expect(() => rememberPendingCode('ABCDEFGHJK', broken)).not.toThrow()
    expect(takePendingCode(broken)).toBeNull()
  })
})
