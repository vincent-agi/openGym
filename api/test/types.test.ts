import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, loadServer } from './helpers.ts'
import { IDENTITY_KEYS, SOCIAL_KEYS, emptySocialCollections } from '../types.ts'
import type { Db } from '../types.ts'

/**
 * `api/types.ts` describes `db.json`. These tests keep the description honest against the database the
 * running server actually builds, so a collection added in one place and forgotten in the other fails here.
 */

let app: Awaited<ReturnType<typeof startTestServer>>
let db: Db

before(async () => {
  app = await startTestServer()
  db = (await loadServer()).db
})
after(async () => { await app.close() })

test('a fresh social store has exactly the declared collections, each empty', () => {
  const store = emptySocialCollections()
  assert.deepEqual(Object.keys(store).sort(), [...SOCIAL_KEYS].sort())
  for (const [key, value] of Object.entries(store)) {
    assert.ok(Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0, `${key} is empty`)
  }
})

test('every call returns new objects, so two stores never share state', () => {
  const a = emptySocialCollections()
  const b = emptySocialCollections()
  a.friendships.push({ id: 'x' } as never)
  a.socialSummaries['u'] = {} as never
  assert.equal(b.friendships.length, 0)
  assert.deepEqual(b.socialSummaries, {})
})

test('the database the server builds has every identity and social collection, and nothing undeclared', () => {
  app.createUser('typed')                                  // forces the identity store to be written
  const declared = new Set<string>([...IDENTITY_KEYS, ...SOCIAL_KEYS])
  const actual = new Set(Object.keys(db))
  assert.deepEqual([...declared].filter(k => !actual.has(k)), [], 'declared but missing from the database')
  assert.deepEqual([...actual].filter(k => !declared.has(k)), [], 'in the database but not declared in api/types.ts')
})

test('map-like collections are objects and list-like ones are arrays, as declared', () => {
  for (const key of ['socialSummaries', 'challengeProgress'] as const) assert.ok(!Array.isArray(db[key]) && typeof db[key] === 'object', key)
  for (const key of ['users', 'creds', 'subs', 'invites', 'friendships', 'friendCodes', 'challenges', 'socialEvents', 'socialCheers', 'cheerMutes', 'socialOutbox', 'socialPushLog'] as const) {
    assert.ok(Array.isArray(db[key]), key)
  }
})
