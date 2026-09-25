#!/usr/bin/env bun

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import { validate_inputs, output_options, run } from './args'
import { layout, render } from './render'
import { layout_deck, render_deck } from './deck'
import { create_evaluator } from './plugins'

import type { RenderOptions } from './args'
import type { LayoutOptions } from './render'

type CliOptions = RenderOptions & { plugin: string[] }

const program0 = new Command()
  .name('gum')
  .description('Render JSX files or stdin, or a deck directory as PDF. Unsized figures receive a 640 × 480 offer; source sizes and natural content sizes are retained.')
  .allowExcessArguments(false)
  .argument('[files...]', 'JSX files or one deck directory (omit or use - for stdin)', ['-'])

const program = output_options(program0)
  .option('--plugin <module>', 'Load extra element/helper bindings from a package or file (repeatable)',
    (plugin: string, plugins: string[]) => [...plugins, plugin], [])
  .action(async (files: string[], values: CliOptions) => {
    const inputs = validate_inputs(files, values)
    const evaluator = await create_evaluator(values.plugin)
    if (inputs.multi) {
      const { deck } = inputs
      const options = { theme: values.theme, width: values.width, height: values.height }
      const result = layout_deck(deck, evaluator, options)
      render_deck(result, values)
    } else {
      const { file, format } = inputs
      const defaultTheme = format == 'kitty' ? 'dark' : 'light'
      const options: LayoutOptions = { theme: values.theme, defaultTheme, width: values.width, height: values.height }
      const name = file === '-' ? 'stdin.jsx' : resolve(file)
      const source = readFileSync(file === '-' ? 0 : file, 'utf8')
      const tree = evaluator.evaluate(source, { name })
      const result = layout(tree, options)
      return render(result, format, values)
    }
  })

await run(program)
