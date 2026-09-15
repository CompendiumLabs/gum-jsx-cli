#!/usr/bin/env bun

import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { evaluate } from 'gum-jsx-core'
import * as math from 'gum-jsx-math'
import { output_options, render, run } from './render'
import type { RenderOptions } from './render'

const program = output_options(new Command()
  .name('gum')
  .description('Read JSX from a file or stdin. Omitted viewport dimensions use source sizing or hug content.')
  .argument('[file]', 'JSX file (omit or use - for stdin)'))
  .action(async (file: string | undefined, values: RenderOptions) => {
    const code = readFileSync(!file || file === '-' ? 0 : file, 'utf8')
    await render(evaluate(code, { name: file ?? 'stdin.jsx', scope: math }), values)
  })

await run(program)
