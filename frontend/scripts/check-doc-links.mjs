#!/usr/bin/env node
// Checks that every relative link in the Markdown documentation points at a file that exists.
//
//   node scripts/check-doc-links.mjs
//
// Scans README.md, CONTRIBUTING.md, SECURITY.md and docs/**/*.md. External links (http, https,
// mailto) and in-page anchors are ignored; for `file.md#section` only the file is checked.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const walk = dir => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
const files = [
  ...['README.md', 'CONTRIBUTING.md', 'SECURITY.md'].map(f => join(repo, f)),
  ...walk(join(repo, 'docs')).filter(f => f.endsWith('.md'))
].filter(existsSync)

// [text](target) — skips images' alt text handling since both forms share the target syntax.
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

const broken = []
for (const file of files) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '')   // links inside code blocks are examples
  for (const m of text.matchAll(LINK)) {
    const target = m[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const path = decodeURIComponent(target.split('#')[0])
    if (path && !existsSync(resolve(dirname(file), path))) broken.push(`${file.replace(repo + '/', '')}: ${target}`)
  }
}

if (broken.length) {
  console.error(`Broken documentation links:\n  ${broken.join('\n  ')}`)
  process.exit(1)
}
console.log(`${files.length} documents, no broken relative links.`)
