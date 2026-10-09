import { extname, join, resolve } from 'node:path'
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { Command, Option, InvalidArgumentError } from 'commander'

import type { OutputPrecision, ThemeName, TextRenderMode } from '@gum-jsx/core'
import type { PngEncoding, RasterSelection } from '@gum-jsx/png'

const FORMATS = ['kitty', 'svg', 'png', 'pdf', 'pptx', 'mp4', 'tree', 'json'] as const
type Format = typeof FORMATS[number]

type RenderOptions = {
  format?: string
  output?: string
  width?: number
  height?: number
  ratio: number
  pngEncoding?: PngEncoding
  textMode?: TextRenderMode
  select?: RasterSelection
  background?: string
  theme?: ThemeName
  title?: string
  idPrefix: string
  precision?: OutputPrecision
  stats?: boolean
  page?: number
  time?: number
  qp?: number
}

type DeckIndex = {
  title?: string
  prelude?: string
  slides?: string[]
}

type DeckInput = { multi: true; format: 'pdf' | 'pptx'; deck: DeckIndex }
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

// Human-facing page numbers start at one, independently of array indices.
function page_option(value: string): number {
  const page = number_option(value, 'page')
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new InvalidArgumentError('page must be a positive integer')
  }
  return page
}

function precision_option(value: string): OutputPrecision {
  if (value === 'full') return value
  if (!/^(?:[0-9]|[1-9][0-9]|100)$/.test(value)) {
    throw new InvalidArgumentError('precision must be an integer from 0 to 100, or "full"')
  }
  return Number(value)
}

function qp_option(value: string): number {
  const qp = number_option(value, 'qp')
  if (!Number.isInteger(qp) || qp < 10 || qp > 51) {
    throw new InvalidArgumentError('qp must be an integer from 10 to 51')
  }
  return qp
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
  if (format !== 'pdf' && format !== 'pptx' && (hasDir || multiFile)) {
    throw new Error('Directories and multiple files require PDF or PPTX output')
  }
  if (values.qp !== undefined && format !== 'mp4') throw new Error('--qp requires MP4 output')
  if (values.page !== undefined && (format === 'mp4' || values.time !== undefined)) {
    throw new Error('--page selects a document page; use --time for a video frame')
  }
  if (values.time !== undefined && (format === 'mp4' || hasDir || multiFile)) {
    throw new Error('--time selects a frame from one video source; omit it for MP4 export')
  }
  if (format === 'mp4' && (values.select !== undefined || values.ratio !== 1 || values.stats)) {
    throw new Error('MP4 does not support --select, --ratio, or --stats; use -W/-H to set its dimensions')
  }

  // two deck cases
  if (hasDir || multiFile) {
    const deck = hasDir ? index_deck(files[0]) :
      { slides: files, title: values.title }
    return { multi: true, format, deck } as DeckInput
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
    .option('--page <number>', 'Select one page (starting at 1) from a document', page_option)
    .option('--time <seconds>', 'Preview a frame from a video source (default: 0)', value => number_option(value, 'time'))
    .option('--qp <number>', 'MP4 quantizer, 10–51; lower is higher quality (default: 18)', qp_option)
    .option('-W, --width <pixels>', 'Set the viewport width', value => number_option(value, 'width'))
    .option('-H, --height <pixels>', 'Set the viewport height', value => number_option(value, 'height'))
    .option('-r, --ratio <number>', 'PNG/kitty sampling ratio', ratio_option, 1)
    .addOption(new Option('--png-encoding <preset>', 'Lossless PNG/kitty encoding policy')
      .choices(['fast', 'standard']).default('fast'))
    .option('--select <x,y,width,height>', 'Crop PNG/kitty to a box in source pixels', selection_option)
    .option('-b, --background <color>', 'Paint the viewport background')
    .addOption(new Option('-t, --theme <theme>', 'Render theme (default: source theme, or dark for kitty / light otherwise)')
      .choices(['light', 'dark']))
    .option('--font <file>', 'Load a font face using its family, weight, and style metadata (repeatable)',
      (file: string, files: string[]) => [...files, file], [])
    .option('--title <text>', 'Set the SVG, PDF, or PPTX document title')
    .option('--id-prefix <name>', 'Prefix SVG definition IDs', 'gum')
    .option('--precision <digits|full>', 'Output decimal places (0–100; default: 10)', precision_option)
    .addOption(new Option('--text-mode <mode>', 'Text and math in SVG/PDF/PPTX (mixed outlines math; default: path for SVG, live for PDF, mixed for PPTX; other formats use paths)')
      .choices(['path', 'live', 'mixed']))
    .option('--stats', 'Print layout counters to stderr')
}

async function run(program: Command, args: string[]): Promise<void> {
  try { await program.parseAsync(args, { from: 'user' }) }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

export { infer_format, validate_inputs, output_options, number_option, run }
export type { RenderOptions, DeckIndex }
