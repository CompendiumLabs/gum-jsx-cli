import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { evaluate, evaluate_prelude } from '@gum-jsx/core'
import * as math from '@gum-jsx/math'

type DeckIndex = { title?: string; prelude?: string; slides?: string[] }
type Source = { file: string; prelude?: string }

function read_index(dir: string): DeckIndex {
  const path = join(dir, 'index.json')
  if (!existsSync(path)) return {}
  const index = JSON.parse(readFileSync(path, 'utf8'))
  if (index === null || typeof index !== 'object' || Array.isArray(index)) {
    throw new Error(`${path}: expected an object`)
  }
  for (const key of ['title', 'prelude'] as const) {
    if (index[key] !== undefined && typeof index[key] !== 'string') {
      throw new Error(`${path}: "${key}" must be a string`)
    }
  }
  if (index.slides !== undefined && !(Array.isArray(index.slides)
    && index.slides.every((slide: unknown) => typeof slide === 'string' && slide.length > 0))) {
    throw new Error(`${path}: "slides" must be a list of filenames`)
  }
  return index
}

function load_deck(directory: string): { title?: string; sources: Source[] } {
  const dir = resolve(directory), index = read_index(dir)
  const prelude = index.prelude === undefined ? undefined : resolve(dir, index.prelude)
  const files = index.slides ?? readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsx') && resolve(dir, entry.name) !== prelude)
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  if (files.length === 0) throw new Error(`${directory}: no slides to render`)
  return { title: index.title, sources: files.map(file => ({ file: resolve(dir, file), prelude })) }
}

function file_source(file: string): Source {
  if (file === '-') return { file }
  const path = resolve(file), index = read_index(dirname(path))
  const prelude = index.prelude === undefined ? undefined : resolve(dirname(path), index.prelude)
  return { file: path, prelude: prelude === path ? undefined : prelude }
}

// One evaluator per invocation: each shared prelude runs once, while slides
// have separate local declarations and retain the parser's bare-JSX behavior.
function source_evaluator() {
  const scopes = new Map<string, Record<string, unknown>>()
  return ({ file, prelude }: Source): unknown => {
    let scope: Record<string, unknown> = math
    if (prelude !== undefined) {
      let shared = scopes.get(prelude)
      if (!shared) {
        shared = { ...math, ...evaluate_prelude(readFileSync(prelude, 'utf8'), { name: prelude, scope: math }) }
        scopes.set(prelude, shared)
      }
      scope = shared
    }
    return evaluate(readFileSync(file === '-' ? 0 : file, 'utf8'), {
      name: file === '-' ? 'stdin.jsx' : file, scope,
    })
  }
}

export { load_deck, file_source, source_evaluator }
export type { Source }
