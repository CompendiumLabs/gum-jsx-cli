import { writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { Command, InvalidArgumentError, Option } from 'commander'
import { available, exact, make_request, layout_element, render_svg, inspect_fragment,
  DEFAULT_OUTPUT_PRECISION } from '@gum-jsx/core'
import type { OutputPrecision, ThemeName } from '@gum-jsx/core'
import type { RasterSelection } from '@gum-jsx/png'
import { createMathFonts } from '@gum-jsx/math'
import { format_image } from './kitty'

type RenderOptions = {
  format?: string
  output?: string
  width?: number
  height?: number
  ratio: number
  select?: RasterSelection
  background?: string
  theme?: ThemeName
  title?: string
  idPrefix: string
  precision?: OutputPrecision
  stats?: boolean
}

type GumOptions = RenderOptions & { natural?: boolean }

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

function precision_option(value: string): OutputPrecision {
  if (value === 'full') return value
  if (!/^(?:[0-9]|[1-9][0-9]|100)$/.test(value)) {
    throw new InvalidArgumentError('precision must be an integer from 0 to 100, or "full"')
  }
  return Number(value)
}

function selection_option(value: string): RasterSelection {
  const parts = value.split(',')
  const [x, y, width, height] = parts.map(part => part.trim() === '' ? NaN : Number(part))
  if (parts.length !== 4 || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new InvalidArgumentError('select must be x,y,width,height in pixels with finite coordinates and positive dimensions')
  }
  return { x, y, width, height }
}

// Sources that return a plain value print it as text: strings verbatim, the rest as JSON.
function format_value(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)
}

function output_format(values: RenderOptions): string {
  const format = values.format ?? (values.output ? extname(values.output).slice(1) : 'kitty')
  if (!formats.includes(format)) throw new Error(`Unknown format: ${format}`)
  if (values.select && format !== 'png' && format !== 'kitty') {
    throw new Error('--select is only available for PNG and kitty output')
  }
  return format
}

function layout(value: unknown, values: RenderOptions) {
  const { width, height } = values
  const format = output_format(values)
  // A finite offer lets unsized figures lay out; it does not clip tall documents
  // or replace source dimensions. A single explicit axis leaves the other natural.
  const { width0, height0 } = (width === undefined && height === undefined) ?
    { width0: available(640), height0: available(480) } :
    { width0: undefined, height0: undefined }
  const request = make_request({
    width: width === undefined ? width0 : exact(width),
    height: height === undefined ? height0 : exact(height),
  })
  return layout_element(value, {
    request,
    defaults: { theme: format === 'kitty' ? 'dark' : 'light' },
    overrides: { theme: values.theme },
    fonts: createMathFonts(),
  })
}

// Both authoring commands share layout and the selected export backend.
async function render(value: unknown, values: RenderOptions): Promise<void> {
  const format = output_format(values)
  const result = layout(value, values)
  let output: string | Uint8Array
  if (result.kind === 'value') output = format_value(result.value) + '\n'
  else if (format === 'tree') output = inspect_fragment(result.fragment, {
    precision: values.precision ?? DEFAULT_OUTPUT_PRECISION,
  }) + '\n'
  else if (format === 'json') output = JSON.stringify(result.fragment, null, 2) + '\n'
  else if (format === 'pdf') {
    const { render_pdf } = await import('@gum-jsx/pdf')
    output = render_pdf(result.fragment, {
      background: values.background, title: values.title, precision: values.precision,
    })
  }
  else {
    output = render_svg(result.fragment, {
      background: values.background, title: values.title, id_prefix: values.idPrefix,
      precision: values.precision,
    })
    if (format === 'png' || format === 'kitty') {
      const { rasterize_svg } = await import('@gum-jsx/png')
      const png = rasterize_svg(output, { size: result.fragment.size, ratio: values.ratio, select: values.select })
      output = format === 'kitty' ? format_image(png) + '\n' : png
    } else output += '\n'
  }
  if (values.output) writeFileSync(values.output, output)
  else process.stdout.write(output)
  if (values.stats && result.kind === 'fragment') console.error(JSON.stringify(result.pass.stats))
}

function output_options(program: Command): Command {
  return program
    .addOption(new Option('-f, --format <format>', 'Output format (default: kitty or output extension)')
      .choices(formats))
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .option('-W, --width <pixels>', 'Set the viewport width', value => number_option(value, 'width'))
    .option('-H, --height <pixels>', 'Set the viewport height', value => number_option(value, 'height'))
    .option('-r, --ratio <number>', 'PNG/kitty sampling ratio', ratio_option, 1)
    .option('--select <x,y,width,height>', 'Crop PNG/kitty to a box in source pixels', selection_option)
    .option('-b, --background <color>', 'Paint the viewport background')
    .addOption(new Option('-t, --theme <theme>', 'Render theme (default: source theme, or dark for kitty / light otherwise)')
      .choices(['light', 'dark']))
    .option('--title <text>', 'Set the SVG or PDF document title')
    .option('--id-prefix <name>', 'Prefix SVG definition IDs', 'gum')
    .option('--precision <digits|full>', 'Output decimal places (0–100; default: 10)', precision_option)
    .option('--stats', 'Print layout counters to stderr')
}

async function run(program: Command): Promise<void> {
  try { await program.parseAsync() }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

export { render, layout, output_format, output_options, number_option, run }
export type { RenderOptions, GumOptions }
