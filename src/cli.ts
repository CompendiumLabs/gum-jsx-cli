#!/usr/bin/env bun

import { statSync, writeFileSync } from 'node:fs'
import { Command } from 'commander'
import { output_options, output_format, layout, render, run } from './render'
import type { RenderOptions } from './render'
import { file_source, load_deck, source_evaluator } from './deck'
import type { Source } from './deck'

type GumOptions = RenderOptions & { natural?: boolean }

async function render_pdf_files(inputs: { file: string; directory: boolean }[], values: GumOptions): Promise<void> {
  const { render_pdf } = await import('@gum-jsx/pdf')
  const sources: Source[] = []
  let title = values.title
  for (const { file, directory } of inputs) {
    if (directory) {
      const deck = load_deck(file)
      sources.push(...deck.sources)
      if (inputs.length === 1) title ??= deck.title
    } else sources.push(file_source(file))
  }
  const evaluate = source_evaluator()
  const results = sources.map(source => {
    const result = layout(evaluate(source), values, !values.natural)
    if (result.kind !== 'fragment') throw new Error(`${source.file}: PDF pages must return a Gum element`)
    return result
  })
  const output = render_pdf(results.map(result => result.fragment), {
    background: values.background, title, precision: values.precision,
  })
  if (values.output) writeFileSync(values.output, output)
  else process.stdout.write(output)
  if (values.stats) for (const result of results) console.error(JSON.stringify(result.pass.stats))
}

const program = output_options(new Command()
  .name('gum')
  .description('Read JSX from files or stdin. PDF output also accepts deck directories. Unsized figures receive a 640 × 480 offer; source sizes and natural content sizes are retained.')
  .argument('[files...]', 'JSX files or deck directories (omit or use - for stdin)'))
  .option('--natural', 'Measure without the default 640 × 480 offer')
  .action(async (files: string[], values: GumOptions) => {
    const format = output_format(values)
    if (files.length === 0) files = ['-']
    if (files.filter(file => file === '-').length > 1) throw new Error('Stdin may only be used once')
    const inputs = files.map(file => ({ file, directory: file !== '-' && statSync(file).isDirectory() }))
    if (inputs.length > 1 || inputs[0].directory) {
      if (format !== 'pdf') throw new Error('Multiple files and deck directories require PDF output (-f pdf or -o deck.pdf)')
      await render_pdf_files(inputs, values)
    } else {
      await render(source_evaluator()(file_source(files[0])), values, !values.natural)
    }
  })

await run(program)
