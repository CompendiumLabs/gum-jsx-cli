import { writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { Command, InvalidArgumentError, Option } from 'commander'
import { Svg, LayoutPass, exact, make_request, render_svg, inspect_fragment } from 'gum-jsx-core'
import type { Element, ThemeName } from 'gum-jsx-core'
import { createMathFonts } from 'gum-jsx-math'
import { format_image } from './kitty'

type RenderOptions = {
  format?: string
  output?: string
  width?: number
  height?: number
  ratio: number
  background?: string
  theme?: ThemeName
  title?: string
  idPrefix: string
  stats?: boolean
}

const formats = ['kitty', 'svg', 'png', 'pdf', 'tree', 'json']

// CLI sizes are explicit pixels; raster ratio is independent of the layout viewport.
function number_option(value: string, name: string): number {
  const number = value.trim() === '' ? NaN : Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new InvalidArgumentError(`${name} must be nonnegative and finite`)
  }
  return number
}

function ratio_option(value: string): number {
  const ratio = number_option(value, 'ratio')
  if (ratio === 0) throw new InvalidArgumentError('ratio must be positive')
  return ratio
}

// Both authoring commands share layout and the selected export backend.
async function render(element: Element, values: RenderOptions): Promise<void> {
  const { width, height, ratio } = values
  const format = values.format ?? (values.output ? extname(values.output).slice(1) : 'kitty')
  if (!formats.includes(format)) throw new Error(`Unknown format: ${format}`)
  const viewport = element instanceof Svg ? element : new Svg({ children: element })
  element = new Svg(viewport.type, {
    ...viewport.props,
    theme: values.theme ?? viewport.props.theme ?? (format === 'kitty' ? 'dark' : 'light'),
  })
  const request = make_request({
    ...(width === undefined ? {} : { width: exact(width) }),
    ...(height === undefined ? {} : { height: exact(height) }),
  })
  const fonts = createMathFonts()
  const pass = new LayoutPass({ fonts: { value: fonts, version: fonts.version } })
  const fragment = pass.layout(element, request)

  let output: string | Uint8Array
  if (format === 'tree') output = inspect_fragment(fragment) + '\n'
  else if (format === 'json') output = JSON.stringify(fragment, null, 2) + '\n'
  else if (format === 'pdf') {
    const { render_pdf } = await import('@gum-jsx/pdf')
    output = render_pdf(fragment, { background: values.background, title: values.title })
  }
  else {
    output = render_svg(fragment, {
      background: values.background, title: values.title, id_prefix: values.idPrefix,
    })
    if (format === 'png' || format === 'kitty') {
      const { rasterize_svg } = await import('gum-jsx-png')
      const png = rasterize_svg(output, { size: fragment.size, ratio })
      output = format === 'kitty' ? format_image(png) + '\n' : png
    } else output += '\n'
  }
  if (values.output) writeFileSync(values.output, output)
  else process.stdout.write(output)
  if (values.stats) console.error(JSON.stringify(pass.stats))
}

function output_options(program: Command): Command {
  return program
    .addOption(new Option('-f, --format <format>', 'Output format (default: kitty or output extension)')
      .choices(formats))
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .option('-W, --width <pixels>', 'Set the viewport width', value => number_option(value, 'width'))
    .option('-H, --height <pixels>', 'Set the viewport height', value => number_option(value, 'height'))
    .option('-r, --ratio <number>', 'PNG/kitty sampling ratio', ratio_option, 1)
    .option('-b, --background <color>', 'Paint the viewport background')
    .addOption(new Option('-t, --theme <theme>', 'Render theme (default: source theme, or dark for kitty / light otherwise)')
      .choices(['light', 'dark']))
    .option('--title <text>', 'Set the SVG or PDF document title')
    .option('--id-prefix <name>', 'Prefix SVG definition IDs', 'gum')
    .option('--stats', 'Print layout counters to stderr')
}

async function run(program: Command): Promise<void> {
  try { await program.parseAsync() }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

export { render, output_options, number_option, run }
export type { RenderOptions }
