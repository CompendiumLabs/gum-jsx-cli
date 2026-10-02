import { readFileSync, writeFileSync } from 'node:fs'
import { Evaluator } from '@gum-jsx/core'
import { render_pdf } from '@gum-jsx/pdf'
import { render_pptx } from '@gum-jsx/pptx'
import { layout } from './render'

import type { Fragment, LayoutPass } from '@gum-jsx/core'
import type { RenderOptions, DeckIndex } from './args'
import type { LayoutOptions } from './render'

type DeckFragment = Readonly<{ kind: "fragment"; fragment: Fragment; pass: LayoutPass; }>
type DeckResult = { results: DeckFragment[]; title?: string }

// Evaluate the deck's prelude once; each slide keeps its own local declarations.
function layout_deck(deck: DeckIndex, evaluator: Evaluator, options: LayoutOptions): DeckResult {
  const { title, prelude, slides = [] } = deck
  const scope = prelude === undefined ? undefined
    : evaluator.evaluate_prelude(readFileSync(prelude, 'utf8'), { name: prelude })
  const results = slides.map(file => {
    const src = readFileSync(file, 'utf8')
    const tree = evaluator.evaluate(src, { name: file, scope })
    const result = layout(tree, options)
    if (result.kind !== 'fragment') throw new Error(`${file}: Deck slides must return a Gum element`)
    return result
  })
  return { results, title }
}

function render_deck(result: DeckResult, values: RenderOptions, format: 'pdf' | 'pptx' = 'pdf') {
  const { results, title } = result
  const render = format === 'pptx' ? render_pptx : render_pdf
  const output = render(results.map(result => result.fragment), {
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

export { layout_deck, render_deck }
export type { DeckIndex }
