import { readFileSync } from 'node:fs'
import { Evaluator } from '@gum-jsx/core'
import { createMathFonts } from '@gum-jsx/math'
import { layout, render } from './render'

import type { LayoutElementResult } from '@gum-jsx/core'
import type { RenderOptions, DeckIndex } from './args'
import type { LayoutOptions } from './render'

type DeckResult = { results: Exclude<LayoutElementResult, { kind: 'value' }>[]; title?: string }

// Evaluate the deck's prelude once; each slide keeps its own local declarations.
function layout_deck(deck: DeckIndex, evaluator: Evaluator, options: LayoutOptions): DeckResult {
  const { title, prelude, slides = [] } = deck
  const scope = prelude === undefined ? undefined
    : evaluator.evaluate_prelude(readFileSync(prelude, 'utf8'), { name: prelude })
  const fonts = options.fonts ?? createMathFonts()
  const results = slides.map(file => {
    const src = readFileSync(file, 'utf8')
    const tree = evaluator.evaluate(src, { name: file, scope })
    const result = layout(tree, { ...options, fonts })
    if (result.kind === 'value') throw new Error(`${file}: Deck slides must return a Gum element or Document`)
    return result
  })
  return { results, title }
}

function render_deck(result: DeckResult, values: RenderOptions, format: 'pdf' | 'pptx' = 'pdf') {
  const { results, title } = result
  if (!results.length) throw new Error('A deck requires at least one page')
  const pages = results.flatMap(result => result.kind === 'document' ? result.pages : [result.fragment])
  render({ kind: 'document', pages, title, pass: results[0].pass }, format, { ...values, stats: false })
  if (values.stats) {
    for (const result of results) {
      console.error(JSON.stringify(result.pass.stats))
    }
  }
}

export { layout_deck, render_deck }
export type { DeckIndex }
