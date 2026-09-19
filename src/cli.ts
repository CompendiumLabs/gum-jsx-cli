#!/usr/bin/env bun

import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { evaluate } from 'gum-jsx-core'
import * as math from 'gum-jsx-math'
import { output_options, render, run } from './render'
import type { RenderOptions } from './render'

const program = output_options(new Command()
  .name('gum')
  .description('Read JSX from a file or stdin. Unsized figures receive a 640 × 480 offer; source sizes and natural content sizes are retained.')
  .argument('[file]', 'JSX file (omit or use - for stdin)'))
  .option('--natural', 'Measure without the default 640 × 480 offer')
  .action(async (file: string | undefined, values: RenderOptions & { natural?: boolean }) => {
    const code = readFileSync(!file || file === '-' ? 0 : file, 'utf8')
    await render(evaluate(code, { name: file ?? 'stdin.jsx', scope: math }), values, !values.natural)
  })

await run(program)
