---
status: proposed
---

# Migrate the codebase to TypeScript, and run the API from source

Gymme is about 28,000 lines of JavaScript (18,000 of code, the rest locales and data) with no static checking: the friends module (v1.7) already shipped
bugs that a type checker catches by construction (a `.then()` without a `.catch()`, a state field read under two
spellings, an API shape the frontend and the API each guessed). We will migrate `api/` and `frontend/` to
TypeScript, incrementally and leaf-first, with strict checking on every file the moment it becomes TypeScript. The API
keeps running straight from its sources: **no build step**, Node strips the types.

Tracking: milestone *v1.8 - TypeScript Migration* (issues #52 to #70).

## Decisions

1. **Scope.** All of `api/`, `frontend/src`, the frontend config (`vite.config`) and the Node scripts. Two deliberate
   exceptions stay JavaScript: `frontend/public/sw.js` (copied verbatim into the build, so it cannot be compiled) and
   `website/site.js` (a static site with no build). Both get `// @ts-check` with JSDoc types instead.
2. **API runtime: Node's native type stripping.** `node server.ts` on Node >= 22.18 (the current `node:22-alpine` is 22.23 and
   runs `.ts` files with no flag and no warning). `tsc --noEmit` only *checks*; it emits nothing. The price is *erasable syntax only*
   (`erasableSyntaxOnly`: no `enum`, `namespace` or constructor parameter properties), `import type` for types
   (`verbatimModuleSyntax`) and `.ts` extensions in relative imports (`allowImportingTsExtensions`).
3. **Frontend: Vite and Vitest compile TypeScript themselves** (no type checking), so `tsc --noEmit` becomes a CI gate
   next to the tests. `jsx: react-jsx`.
4. **Incremental, strict from day one.** `allowJs: true` and `checkJs: false` during the migration, so unconverted files cost
   nothing; every converted file is checked under `strict`. A rename-only commit comes first, the edit in a second commit,
   so Git keeps the history. The end state is `allowJs: false`, plus `noUncheckedIndexedAccess` as a last ratchet.
5. **One shared contract.** A `shared/` directory of erasable TypeScript holds the wire types of the HTTP API and the constants both
   sides must agree on (`CHEER_EMOJI`, `SUMMARY_KEYS`, `BADGES`, `NOTIFY_KINDS`, limits). It replaces the five test files that
   import `../../../api/*.js` today. It is a plain directory imported by relative path, **not** an npm workspace.
6. **Hand-written validators stay**, now typed. No runtime schema library (zod and the like) in this migration.
7. **Large data stays data.** `exercises-data` (about 900 KB) is annotated `Exercise[]`, never `as const`; locales are
   `Record<string, string>`. Message keys are not typed: they are English sentences used at hundreds of call sites.

## Considered options

- **Compile with `tsc` to `dist/` for the API.** Works on any Node, but adds a multi-stage Dockerfile, a build step for every
  run and test, source maps for readable stack traces (`SECURITY.md` and the docs cite `server.js` lines) and a `dist/` that
  can drift from the source. Rejected because Node already does the job. It stays the **fallback**: since only erasable
  syntax is allowed, switching to `tsc` emit later needs no source change.
- **`tsx` or `ts-node` at runtime.** A runtime dependency on an API whose one runtime dependency is a point of pride, plus
  start-up cost and attack surface. Rejected.
- **Bun or Deno.** Swaps the runtime for the sake of types. Rejected.
- **npm workspaces for the shared code.** One lockfile and clean imports, but it restructures Dependabot, the two
  Dockerfiles and the CI caches. Rejected for now; the `shared/` layout can become a workspace later.
- **Generate types from an OpenAPI or zod schema.** A schema language and a generation step for a 47-route API. Rejected.
- **Keep JSDoc types (`checkJs`) and stay in JavaScript.** The cheapest option, and the weakest: types live in comments,
  `strict` cannot be enforced per file, and refactors do not carry them along. Rejected, except for the two files above.

## Consequences

- Contributors need Node >= 22.18 (`engines` in `api/package.json`; the Docker images already comply).
- The API image is built from the repository root, because it now needs `shared/`. `docker-compose.yml`, the publish workflow
  and the Dependabot Docker entry change with it.
- Every doc that cites `server.js`, `*.jsx` or a line number is updated; `SECURITY.md` references symbols rather than lines.
- `git blame` is polluted by the renames; the rename-only commits go into `.git-blame-ignore-revs`.
- Open feature branches conflict with renames. The migration is ordered leaf-first and in small pull requests to keep that window short.
- `tsc --noEmit` over `exercises-data` must stay under a stated time budget; if it does not, that file is typed through a `.d.ts` and the data moves to JSON.
