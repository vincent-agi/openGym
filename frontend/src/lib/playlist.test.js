import { describe, it, expect } from 'vitest'
import { parsePlaylistUrl, restEndPlaylist } from './playlist.js'

describe('parsePlaylistUrl', () => {
  it('recognizes Spotify links, with or without www', () => {
    expect(parsePlaylistUrl('https://open.spotify.com/playlist/abc123')).toEqual(
      { valid: true, provider: 'spotify', url: 'https://open.spotify.com/playlist/abc123' })
    expect(parsePlaylistUrl('https://www.spotify.com/track/abc').provider).toBe('spotify')
  })

  it('recognizes YouTube and YouTube Music links, and the youtu.be short host', () => {
    expect(parsePlaylistUrl('https://music.youtube.com/playlist?list=abc').provider).toBe('youtube')
    expect(parsePlaylistUrl('https://www.youtube.com/watch?v=abc').provider).toBe('youtube')
    expect(parsePlaylistUrl('https://youtu.be/abc').provider).toBe('youtube')
  })

  it('recognizes Apple Music links', () => {
    expect(parsePlaylistUrl('https://music.apple.com/us/playlist/abc/pl.123').provider).toBe('apple')
  })

  it('classifies any other well-formed https URL as generic rather than rejecting it', () => {
    const r = parsePlaylistUrl('https://example.com/my-mixtape')
    expect(r).toEqual({ valid: true, provider: 'generic', url: 'https://example.com/my-mixtape' })
  })

  it('rejects a non-https URL', () => {
    expect(parsePlaylistUrl('http://open.spotify.com/playlist/abc').valid).toBe(false)
  })

  it('rejects garbage that is not a URL at all', () => {
    expect(parsePlaylistUrl('not a url').valid).toBe(false)
    expect(parsePlaylistUrl('').valid).toBe(false)
  })

  it('does not false-positive on a host that merely contains a provider name', () => {
    expect(parsePlaylistUrl('https://notspotify.com/playlist/abc').provider).toBe('generic')
    expect(parsePlaylistUrl('https://spotify.com.evil.example/x').provider).toBe('generic')
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(parsePlaylistUrl('  https://open.spotify.com/playlist/abc  ').valid).toBe(true)
  })
})

describe('restEndPlaylist', () => {
  const playlist = { url: 'https://open.spotify.com/playlist/abc', provider: 'spotify' }
  const base = { routines: [{ id: 'r1', playlist }], active: { routineId: 'r1' }, playlistCue: true }

  it('returns the active routine\'s playlist when the cue is on', () => {
    expect(restEndPlaylist(base)).toBe(playlist)
  })

  it('returns null when the cue is explicitly off', () => {
    expect(restEndPlaylist({ ...base, playlistCue: false })).toBe(null)
  })

  it('treats a missing playlistCue as on (default true)', () => {
    const { playlistCue, ...rest } = base
    expect(restEndPlaylist(rest)).toBe(playlist)
  })

  it('returns null when there is no active session', () => {
    expect(restEndPlaylist({ ...base, active: null })).toBe(null)
  })

  it('returns null when the active routine has no playlist', () => {
    const S = { routines: [{ id: 'r1' }], active: { routineId: 'r1' }, playlistCue: true }
    expect(restEndPlaylist(S)).toBe(null)
  })

  it('returns null when the active routine id matches nothing (deleted routine)', () => {
    expect(restEndPlaylist({ ...base, active: { routineId: 'gone' } })).toBe(null)
  })
})
