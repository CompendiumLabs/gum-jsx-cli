#!/usr/bin/env bun

import { readFileSync } from 'node:fs'
import { Command, InvalidArgumentError } from 'commander'
import { Fit, Svg, px, em } from 'gum-jsx-core'
import { mathToElement } from 'gum-jsx-math'
import { output_options, render, number_option, run } from './render'
import type { RenderOptions } from './render'

type TexOptions = RenderOptions & {
  input?: string
  fontSize: number
  padding: number
  inline?: boolean
  strut: boolean
  color?: string
  fit?: boolean
  macro: Record<string, string>
}

function macro_option(value: string, previous: Record<string, string>): Record<string, string> {
  const split = value.indexOf('=')
  const name = value.slice(0, split)
  if (split < 0 || !/^\\[A-Za-z]+$/.test(name)) {
    throw new InvalidArgumentError('macro must be a TeX command and expansion, such as \\RR=\\mathbb{R}')
  }
  return { ...previous, [name]: value.slice(split + 1) }
}

const program = output_options(new Command()
  .name('gum-tex')
  .description('Render a TeX formula. Natural exports include the formula’s logical box and visible ink.')
  .argument('[tex]', 'Literal TeX (omit or use - for stdin)'))
  .option('-i, --input <file>', 'Read TeX from a file (- for stdin)')
  .option('-s, --font-size <pixels>', 'Font size in pixels', value => {
    const size = number_option(value, 'font size')
    if (size === 0) throw new InvalidArgumentError('font size must be positive')
    return size
  }, 64)
  .option('-p, --padding <em>', 'Padding on each side in em', value => number_option(value, 'padding'), 0)
  .option('-c, --color <color>', 'Formula color (default: theme foreground)')
  .option('--inline', 'Use text style instead of display style')
  .option('--no-strut', 'Omit the minimum formula line box')
  .option('--macro <command=tex>', 'Define a macro (repeatable)', macro_option, {})
  .option('--fit', 'Uniformly fit into --width/--height instead of clipping at the original font size')
  .addHelpText('after', '\nExamples:\n  gum-tex "x^2" -o formula.svg\n  gum-tex "x^2" --theme dark\n  gum-tex "x^2" --theme light --background white -o formula.png\n  gum-tex -i formula.tex -s 48 -p 0.25 -o formula.png\n  gum-tex "x^2" --fit -W 320\n')
  .action(async (tex: string | undefined, values: TexOptions) => {
    if (values.input !== undefined && tex !== undefined) throw new Error('Use literal TeX or --input, not both')
    if (values.fit && values.width === undefined && values.height === undefined) {
      throw new Error('--fit requires --width or --height')
    }
    const text = values.input !== undefined ? readFileSync(values.input === '-' ? 0 : values.input, 'utf8')
      : tex === undefined || tex === '-' ? readFileSync(0, 'utf8') : tex
    let element = mathToElement(text, { font_size: px(values.fontSize), padding: em(values.padding),
      inline: values.inline, strut: values.strut, color: values.color, macros: values.macro })
    if (values.fit) element = new Svg({ children: new Fit({ children: element }) })
    await render(element, values)
  })

await run(program)
