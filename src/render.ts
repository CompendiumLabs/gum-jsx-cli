import { writeFileSync } from 'node:fs'
import { available, exact, make_request, layout_element, render_svg, inspect_fragment,
  DEFAULT_OUTPUT_PRECISION } from '@gum-jsx/core'
import { createMathFonts } from '@gum-jsx/math'
import { rasterize_svg } from '@gum-jsx/png'
import { render_pdf } from '@gum-jsx/pdf'
import { format_image } from './kitty'

import type { ThemeName, LayoutElementResult } from '@gum-jsx/core'
import type { RenderOptions } from './args'

const DEFAULT_WIDTH = 640
const DEFAULT_HEIGHT = 480

type LayoutOptions = {
  theme?: ThemeName
  width?: number
  height?: number
}

// Sources that return a plain value print it as text: strings verbatim, the rest as JSON.
function format_value(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)
}

// A finite offer lets unsized figures lay out; it does not clip tall documents
// or replace source dimensions. A single explicit axis leaves the other natural.
function layout(value: unknown, { theme, width, height }: LayoutOptions): LayoutElementResult {
  const { width0, height0 } = (width === undefined && height === undefined) ?
    { width0: available(DEFAULT_WIDTH), height0: available(DEFAULT_HEIGHT) } :
    { width0: undefined, height0: undefined }
  const request = make_request({
    width: width === undefined ? width0 : exact(width),
    height: height === undefined ? height0 : exact(height),
  })
  return layout_element(value, {
    request,
    defaults: { theme },
    overrides: { theme },
    fonts: createMathFonts(),
  })
}

// Both authoring commands share layout and the selected export backend.
function render(result: LayoutElementResult, format: string, values: RenderOptions) {
  let output: string | Uint8Array
  if (result.kind === 'value') output = format_value(result.value) + '\n'
  else if (format === 'tree') output = inspect_fragment(result.fragment, {
    precision: values.precision ?? DEFAULT_OUTPUT_PRECISION,
  }) + '\n'
  else if (format === 'json') output = JSON.stringify(result.fragment, null, 2) + '\n'
  else if (format === 'pdf') {
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
      const png = rasterize_svg(output, { size: result.fragment.size, ratio: values.ratio, select: values.select })
      output = format === 'kitty' ? format_image(png) + '\n' : png
    } else output += '\n'
  }
  if (values.output) writeFileSync(values.output, output)
  else process.stdout.write(output)
  if (values.stats && result.kind === 'fragment') console.error(JSON.stringify(result.pass.stats))
}

export { render, layout }
export type { LayoutOptions }
