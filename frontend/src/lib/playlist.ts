// Classifies a playlist/track URL by host so the UI can show the right icon and reject
// anything that isn't a usable link — never tries to validate the playlist actually exists
// (that would need each provider's API), only that the URL is well-formed and https.
const PROVIDER_HOSTS = {
  spotify: ['open.spotify.com', 'spotify.com'],
  youtube: ['music.youtube.com', 'youtube.com', 'youtu.be'],
  apple: ['music.apple.com']
}

export const PROVIDER_LABEL = {
  spotify: 'Spotify', youtube: 'YouTube', apple: 'Apple Music', generic: 'Link'
}

function providerOf(hostname) {
  const h = hostname.replace(/^www\./, '')
  for (const [provider, hosts] of Object.entries(PROVIDER_HOSTS)) {
    if (hosts.some(d => h === d || h.endsWith('.' + d))) return provider
  }
  return 'generic'
}

// { valid, provider, url } — provider is 'spotify' | 'youtube' | 'apple' | 'generic' for any
// other well-formed https URL, or null when the URL itself doesn't parse / isn't https.
export function parsePlaylistUrl(raw) {
  const url = (raw || '').trim()
  let parsed
  try { parsed = new URL(url) } catch { return { valid: false, provider: null, url } }
  if (parsed.protocol !== 'https:') return { valid: false, provider: null, url }
  return { valid: true, provider: providerOf(parsed.hostname), url }
}

// The playlist to offer resuming when a rest timer ends, or null when there's nothing to
// offer — no active session, its routine has no playlist, or the user turned the cue off
// (independent of the `sound` toggle: muting the beep and wanting the music nudge are
// different decisions).
export function restEndPlaylist(S) {
  if (S.playlistCue === false) return null
  const routine = S.routines.find(r => r.id === S.active?.routineId)
  return routine?.playlist || null
}
