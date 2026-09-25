import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Evaluator } from '@gum-jsx/core'
import type { Fragment, LayoutPass } from '@gum-jsx/core'
import { render_pdf } from '@gum-jsx/pdf'
import { layout } from './render'
import type { GumOptions } from './render'

type DeckIndex = { title?: string; prelude?: string; slides?: string[] }
type DeckFragment = Readonly<{ kind: "fragment"; fragment: Fragment; pass: LayoutPass; }>
type DeckResult = { results: DeckFragment[]; title?: string }

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

function load_deck(directory: string): DeckIndex {
  const dir = resolve(directory), index = read_index(dir)
  const prelude = index.prelude === undefined ? undefined : resolve(dir, index.prelude)
  const files = index.slides ?? readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsx') && resolve(dir, entry.name) !== prelude)
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  if (files.length === 0) throw new Error(`${directory}: no slides to render`)
  return { title: index.title, prelude, slides: files.map(file => resolve(dir, file)) }
}

// Evaluate the deck's prelude once; each slide keeps its own local declarations.
function evaluate_deck(deck: DeckIndex, evaluator: Evaluator, values: GumOptions): DeckResult {
  const { title, prelude, slides = [] } = deck
  const scope = prelude === undefined ? undefined
    : evaluator.evaluate_prelude(readFileSync(prelude, 'utf8'), { name: prelude })
  const results = slides.map(file => {
    const src = readFileSync(file, 'utf8')
    const tree = evaluator.evaluate(src, { name: file, scope })
    const result = layout(tree, values)
    if (result.kind !== 'fragment') throw new Error(`${file}: PDF pages must return a Gum element`)
    return result
  })
  return { results, title }
}

async function render_deck(result: DeckResult, values: GumOptions): Promise<void> {
  const { results, title } = result
  const output = render_pdf(results.map(result => result.fragment), {
    background: values.background,
    title: values.title ?? title,
    precision: values.precision,
  })
  if (values.output) {
    writeFileSync(values.output, output)
  } else {
    process.stdout.write(output)
  }
  if (values.stats) {
    for (const result of results) {
      console.error(JSON.stringify(result.pass.stats))
    }
  }
}

export { load_deck, evaluate_deck, render_deck }
export type { DeckIndex as Deck }
