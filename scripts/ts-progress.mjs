#!/usr/bin/env node
// How far the TypeScript migration has got, and a ratchet so it only moves forward.
//
//   node scripts/ts-progress.mjs [--root DIR] [--json | --markdown] [--check]
//
// Counts JavaScript (.js .jsx .mjs .cjs) against TypeScript (.ts .tsx .mts .cts) per package:
// api, frontend, shared, scripts. Not counted: node_modules, dist, android, ios, frontend/public
// (files copied verbatim into the build), and locale / data files (reported separately as "data").
//
// --check reads ts-migrated.txt, a list of directories that are fully TypeScript (one per line, `#`
// comments allowed). It fails when a guarded directory is missing or contains a JavaScript file, so
// converted code cannot slide back. See docs/adr/0001-migrate-to-typescript.md.
//
// Exit codes: 0 ok · 1 ratchet broken · 2 usage error

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGES = ['api', 'frontend', 'shared', 'scripts']
const JS = /\.(js|jsx|mjs|cjs)$/
const TS = /\.(ts|tsx|mts|cts)$/
const NEVER = new Set(['node_modules', 'dist', 'android', 'ios'])
const DATA = /(^|\/)(frontend\/src\/(locales|instr)\/|[^/]*exercises-data\.[jt]s$|[^/]*body-paths\.[jt]s$)/

const args = process.argv.slice(2)
const flags = new Set(['--json', '--markdown', '--check'])
let root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') root = resolve(args[++i] ?? '')
  else if (!flags.has(args[i])) { console.error(`ts-progress: unknown option ${args[i]}`); process.exit(2) }
}

/** Every file under `dir`, as repository-relative POSIX paths, skipping the directories nobody owns. */
function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(name => {
    if (NEVER.has(name)) return []
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [relative(root, full).split(sep).join('/')]
  })
}

const lines = file => readFileSync(join(root, file), 'utf8').split('\n').length - (readFileSync(join(root, file), 'utf8').endsWith('\n') ? 1 : 0)

function report() {
  const packages = []
  let data = 0
  for (const name of PACKAGES) {
    if (!existsSync(join(root, name))) continue
    const row = { name, js: 0, ts: 0, jsLines: 0, tsLines: 0 }
    for (const file of walk(join(root, name))) {
      const isJs = JS.test(file), isTs = TS.test(file)
      if (!isJs && !isTs) continue
      if (file.startsWith('frontend/public/')) continue
      if (DATA.test(file)) { data++; continue }
      if (isJs) { row.js++; row.jsLines += lines(file) } else { row.ts++; row.tsLines += lines(file) }
    }
    packages.push(row)
  }
  const total = packages.reduce((t, p) => ({ js: t.js + p.js, ts: t.ts + p.ts, jsLines: t.jsLines + p.jsLines, tsLines: t.tsLines + p.tsLines }), { js: 0, ts: 0, jsLines: 0, tsLines: 0 })
  return { packages, total, excluded: { data } }
}

const pct = r => (r.js + r.ts ? Math.round((r.ts / (r.js + r.ts)) * 100) : 100)

function markdown(r) {
  const row = (n, p) => `| ${n} | ${p.js} | ${p.ts} | ${pct(p)} % | ${p.jsLines} / ${p.tsLines} |`
  return ['| Package | JavaScript | TypeScript | TypeScript | Lines (JS / TS) |', '|---|---:|---:|---:|---:|',
    ...r.packages.map(p => row(p.name, p)), row('**total**', r.total), '', `Locale and data files are not counted (${r.excluded.data} files).`].join('\n')
}

/** The ratchet: directories listed in ts-migrated.txt must hold no JavaScript. */
function check() {
  const file = join(root, 'ts-migrated.txt')
  const dirs = existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean)
    : []
  const problems = []
  for (const dir of dirs) {
    if (!existsSync(join(root, dir)) || !statSync(join(root, dir)).isDirectory()) { problems.push(`${dir}: no such directory (typo in ts-migrated.txt?)`); continue }
    for (const f of walk(join(root, dir))) if (JS.test(f) && !f.startsWith('frontend/public/')) problems.push(`${f}: JavaScript in a directory that is fully TypeScript`)
  }
  if (problems.length) {
    console.error('TypeScript ratchet broken:\n  ' + problems.join('\n  ') + '\n\nConvert with: scripts/ts-rename.sh <path>   (then type the file; see docs/technical/development.md)')
    process.exit(1)
  }
  console.log(`ts-progress: ratchet holds, ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'} guarded`)
}

const r = report()
if (args.includes('--json')) console.log(JSON.stringify(r, null, 2))
else if (args.includes('--markdown')) console.log(markdown(r))
else if (!args.includes('--check')) {
  for (const p of r.packages) console.log(`${p.name.padEnd(10)} ${String(p.ts).padStart(4)} ts / ${String(p.js).padStart(4)} js   ${String(pct(p)).padStart(3)} %   (${p.tsLines} / ${p.jsLines} lines)`)
  console.log(`${'total'.padEnd(10)} ${String(r.total.ts).padStart(4)} ts / ${String(r.total.js).padStart(4)} js   ${String(pct(r.total)).padStart(3)} %`)
}
if (args.includes('--check')) check()
