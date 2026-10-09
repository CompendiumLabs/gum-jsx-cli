import { writeFileSync } from 'node:fs'
import { LayoutPass, available, exact, make_request, layout_element, render_svg, inspect_fragment,
  DEFAULT_OUTPUT_PRECISION } from '@gum-jsx/core'
import { createMathFonts } from '@gum-jsx/math'
import type { MathFontProvider } from '@gum-jsx/math'
import { render_png } from '@gum-jsx/png'
import { render_pdf } from '@gum-jsx/pdf'
import { render_pptx } from '@gum-jsx/pptx'
import { format_image } from './kitty'

import type { FontProvider, ThemeName, LayoutElementResult, TextRenderMode } from '@gum-jsx/core'
import type { RenderOptions } from './args'

const DEFAULT_WIDTH = 640
const DEFAULT_HEIGHT = 480

type LayoutOptions = {
  theme?: ThemeName
  defaultTheme?: ThemeName
  defaultFont?: string
  width?: number
  height?: number
  textMode?: TextRenderMode
  fonts?: FontProvider
  math_fonts?: MathFontProvider
}

// Sources that return a plain value print it as text: strings verbatim, the rest as JSON.
function format_value(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)
}

// A finite offer lets unsized figures lay out; it does not clip tall documents
// or replace source dimensions. A single explicit axis leaves the other natural.
function layout(value: unknown, options: LayoutOptions): LayoutElementResult {
  const { theme, defaultTheme, defaultFont, width, height, textMode, math_fonts,
    fonts = createMathFonts() } = options
  const { width0, height0 } = (width === undefined && height === undefined) ?
    { width0: available(DEFAULT_WIDTH), height0: available(DEFAULT_HEIGHT) } :
    { width0: undefined, height0: undefined }
  const request = make_request({
    width: width === undefined ? width0 : exact(width),
    height: height === undefined ? height0 : exact(height),
  })
  return layout_element(value, {
    pass: math_fonts ? new LayoutPass({ math_fonts: { value: math_fonts, version: 0 } }) : undefined,
    request,
    defaults: { theme: defaultTheme, font_family: defaultFont },
    overrides: { theme },
    fonts,
    text_mode: textMode,
  })
}

// Both authoring commands share layout and the selected export backend.
function render(result: LayoutElementResult, format: string, values: RenderOptions) {
  // Document pages remain independent through export. Single-image formats need
  // an explicit selection when a document contains more than one page.
  const pages = result.kind === 'value' ? []
    : result.kind === 'document' ? result.pages : [result.fragment]
  const page = values.page
  if (page !== undefined && (!Number.isSafeInteger(page) || page < 1 || page > pages.length)) {
    throw new RangeError(`--page must select a page from 1 to ${pages.length}`)
  }
  const selected = page === undefined ? pages : [pages[page - 1]]
  if (selected.length > 1 && !['pdf', 'pptx', 'tree', 'json'].includes(format)) {
    throw new Error(`${format.toUpperCase()} output requires one page; use --page or export as PDF or PPTX`)
  }
  const fragment = selected[0]
  const title = values.title ?? (result.kind === 'document' ? result.title : undefined)
  let output: string | Uint8Array
  if (result.kind === 'value') output = format_value(result.value) + '\n'
  else if (format === 'tree') output = selected.map((item, index) =>
    (selected.length > 1 ? `Page ${index + 1}\n` : '') + inspect_fragment(item, {
      precision: values.precision ?? DEFAULT_OUTPUT_PRECISION,
    })).join('\n\n') + '\n'
  else if (format === 'json') output = JSON.stringify(
    result.kind === 'document' && page === undefined ? { title, pages } : fragment, null, 2) + '\n'
  else if (format === 'pdf') {
    output = render_pdf(selected, {
      background: values.background, title, precision: values.precision,
      fonts: result.pass.resource<FontProvider>('fonts'),
    })
  }
  else if (format === 'pptx') {
    output = render_pptx(selected, { background: values.background, title,
      fonts: result.pass.resource<FontProvider>('fonts') })
  }
  else if (format === 'png' || format === 'kitty') {
    const options = { ratio: values.ratio, select: values.select, encoding: values.pngEncoding }
    const png = render_png(fragment, { ...options, background: values.background })
    output = format === 'kitty' ? format_image(Buffer.from(png)) + '\n' : png
  }
  else {
    output = render_svg(fragment, {
      background: values.background, title, id_prefix: values.idPrefix,
      precision: values.precision,
    })
    output += '\n'
  }
  if (values.output) writeFileSync(values.output, output)
  else process.stdout.write(output)
  if (values.stats && result.kind !== 'value') console.error(JSON.stringify(result.pass.stats))
}

export { render, layout }
export type { LayoutOptions }
