import { extname, join, resolve } from 'node:path'
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { Command, Option, InvalidArgumentError } from 'commander'

import type { OutputPrecision, ThemeName } from '@gum-jsx/core'
import type { RasterSelection } from '@gum-jsx/png'

const FORMATS = ['kitty', 'svg', 'png', 'pdf', 'tree', 'json'] as const
type Format = typeof FORMATS[number]

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

type DeckIndex = {
  title?: string
  prelude?: string
  slides?: string[]
}

type DeckInput = { multi: true; deck: DeckIndex }
type FileInput = { multi: false;  format: Format; file: string }
type GumInput = FileInput | DeckInput

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

function infer_slides(dir: string, prelude: string | undefined): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry =>
      entry.isFile() &&
      entry.name.endsWith('.jsx') &&
      resolve(dir, entry.name) !== prelude
    )
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

function index_deck(directory: string): DeckIndex {
  const dir = resolve(directory)

  // load and validate index
  const path = join(directory, 'index.json')
  const index = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  if (index === null || typeof index !== 'object' || Array.isArray(index)) {
    throw new Error(`${path}: expected an object`)
  }
  for (const key of ['title', 'prelude'] as const) {
    if (index[key] !== undefined && typeof index[key] !== 'string') {
      throw new Error(`${path}: "${key}" must be a string`)
    }
  }
  if (index.slides !== undefined && !(Array.isArray(index.slides)
    && index.slides.every((slide: unknown) => typeof slide === 'string' && slide.length > 0))) {
    throw new Error(`${path}: "slides" must be a list of filenames`)
  }

  // resolve and validate paths
  const prelude = index.prelude === undefined ? undefined : resolve(dir, index.prelude)
  const files = index.slides ?? infer_slides(dir, prelude)
  if (files.length === 0) throw new Error(`${directory}: no slides to render`)
  const slides = files.map((file: string) => resolve(dir, file))

  // return loaded index
  return { title: index.title, prelude, slides }
}

function infer_format(format0: string | undefined, output: string | undefined): Format {
  const format = format0 ?? (output ? extname(output).slice(1) : 'kitty')
  if (!((FORMATS as readonly string[]).includes(format))) {
    throw new Error(`Unknown format: ${format}`)
  }
  return format as Format
}

function validate_inputs(files: string[], values: RenderOptions): GumInput {
  const multiFile = files.length > 1
  const hasDir = files.some(file => file !== '-' && statSync(file).isDirectory())

  // invalid input combos
  if (hasDir && multiFile) {
    throw new Error('Cannot mix directories and files')
  }
  if (multiFile && files.includes('-')) {
    throw new Error('Cannot mix stdin with multiple files')
  }
  const format = infer_format(values.format ?? ((hasDir || multiFile) && !values.output ? 'pdf' : undefined), values.output)
  if (format !== 'pdf' && (hasDir || multiFile)) {
    throw new Error('Directories and multiple files require PDF output')
  }

  // two deck cases
  if (hasDir || multiFile) {
    const deck = hasDir ? index_deck(files[0]) :
      { slides: files, title: values.title }
    return { multi: true, deck } as DeckInput
  }

  // one file case
  const file = files[0]

  // return inputs
  return { multi: false, format, file } as FileInput
}

function output_options(program: Command): Command {
  return program
    .addOption(new Option('-f, --format <format>', 'Output format (default: kitty or output extension)')
      .choices(FORMATS))
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

export { infer_format, validate_inputs, output_options, number_option, run }
export type { RenderOptions, DeckIndex }
