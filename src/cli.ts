#!/usr/bin/env bun

import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import { output_options, output_format, render, run } from './render'
import { load_deck, evaluate_deck, render_deck } from './deck'
import { create_evaluator } from './plugins'
import type { GumOptions } from './render'

type CliOptions = GumOptions & { plugin: string[] }

const program = output_options(new Command()
  .name('gum')
  .description('Render one JSX file or stdin, or a deck directory as PDF. Unsized figures receive a 640 × 480 offer; source sizes and natural content sizes are retained.')
  .allowExcessArguments(false)
  .argument('[file]', 'One JSX file or deck directory (omit or use - for stdin)', '-'))
  .option('--plugin <module>', 'Load extra element/helper bindings from a package or file (repeatable)',
    (plugin: string, plugins: string[]) => [...plugins, plugin], [])
  .action(async (file: string, values: CliOptions) => {
    const directory = file !== '-' && statSync(file).isDirectory()
    if (directory && values.format === undefined && values.output === undefined) {
      values = { ...values, format: 'pdf' }
    }
    const format = output_format(values)
    if (directory && format !== 'pdf') throw new Error('Deck directories require PDF output (-f pdf or -o deck.pdf)')
    const evaluator = await create_evaluator(values.plugin)
    if (directory) {
      const deck = load_deck(file)
      const result = evaluate_deck(deck, evaluator, values)
      await render_deck(result, values)
    } else {
      const name = file === '-' ? 'stdin.jsx' : resolve(file)
      const source = readFileSync(file === '-' ? 0 : file, 'utf8')
      const result = evaluator.evaluate(source, { name })
      await render(result, values)
    }
  })

await run(program)
