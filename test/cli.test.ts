import { test, expect, afterAll } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { px, THEMES } from '@gum-jsx/core'
import type { Fragment } from '@gum-jsx/core'
import { createMathFonts, mathToSvg } from '@gum-jsx/math'
import { render_pdf } from '@gum-jsx/pdf'
import { render_pptx } from '@gum-jsx/pptx'
import { render_png } from '@gum-jsx/png'
import { decode } from 'fast-png'
import { version } from '../package.json'

const exportSvg = mathToSvg
function drawings(fragment: Fragment): Fragment['draw'][number][] {
  return [...fragment.draw, ...fragment.children.flatMap(child => drawings(child.fragment))]
}
const scratch = mkdtempSync(join(tmpdir(), 'gum-jsx-cli-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let invocation = 0
async function cli(args: string[], input = '', entry = 'cli') {
  // Capture files so Node and Bun use the same output path without pipe buffering.
  const output = join(scratch, `stdout-${++invocation}`)
  const errors = join(scratch, `stderr-${invocation}`)
  const child = Bun.spawn([process.env.GUM_CLI_RUNTIME ?? process.execPath, '--no-addons',
    process.env.GUM_CLI_ENTRY ?? fileURLToPath(new URL(`../src/${entry}.ts`, import.meta.url)), ...args], {
    stdin: new Blob([input]), stdout: Bun.file(output), stderr: Bun.file(errors), cwd: scratch,
    env: process.env.GUM_CLI_RUNTIME ? { ...process.env, PATH: '' } : process.env,
  })
  const code = await child.exited
  const [bytes, error] = await Promise.all([
    Bun.file(output).arrayBuffer(), Bun.file(errors).text()])
  return { code, bytes: new Uint8Array(bytes), text: new TextDecoder().decode(bytes), error }
}
function png_size(bytes: Uint8Array) {
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

test('gum prints the package version and exits without rendering', async () => {
  for (const flag of ['--version', '-V']) {
    const result = await cli([flag], 'throw new Error("Unexpected evaluation")', 'cli')
    expect(result.code).toBe(0)
    expect(result.text).toBe(`${version}\n`)
    expect(result.error).toBe('')
  }
  const help = await cli(['--help'], '', 'cli')
  expect(help.text).toContain('-V, --version')
})

test('gum renders named map coordinates and position spreads with the same geometry as tuples', async () => {
  const source = `
    const position = {lon: 30, lat: 20}
    return <GeoMap source={world_countries({ids: []})} width={px(120)} height={px(80)}>
      <Rect {...{pos: position}} width={px(4)} height={px(6)} />
      <Points points={[position]} point-size={px(8)} />
    </GeoMap>
  `
  const named = await cli(['-f', 'svg'], source, 'cli')
  const tuples = await cli(['-f', 'svg'], source.replace('{lon: 30, lat: 20}', '[30, 20]'), 'cli')
  expect(named.code).toBe(0)
  expect(tuples.code).toBe(0)
  expect(named.text).toBe(tuples.text)
})

test('gum crops PNG and kitty output in source pixels before applying ratio', async () => {
  const args: string[] = []
  const source = '<Square width={px(40)} fill="red" />'
  const options = [...args, '--select', '10,5,12,8', '--ratio', '3', '--theme', 'light']
  const png = await cli([...options, '-f', 'png'], source, 'cli')
  expect(png.code).toBe(0)
  expect(png_size(png.bytes)).toEqual({ width: 36, height: 24 })
  const kitty = await cli(options, source, 'cli')
  expect(kitty.code).toBe(0)
  const encoded = [...kitty.text.matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].map(match => match[1]).join('')
  expect(new Uint8Array(Buffer.from(encoded, 'base64'))).toEqual(png.bytes)
  const unsupported = await cli([...options, '-f', 'svg'], source, 'cli')
  for (const select of ['0,0,0,5', '1,2,3', 'NaN,0,2,2', '0,,2,2']) {
    const invalid = await cli([...args, '--select', select], source, 'cli')
    expect(invalid.code).toBe(1)
    expect(invalid.error).toContain('select must be')
  }
})

test('PNG encoding presets reach file and terminal output in gum', async () => {
  const args: string[] = []
  const source = '<Text font-size={px(36)}>PNG encoding</Text>'
  const options = [...args, '--theme', 'light', '-W', '150', '-H', '50']
  const json = await cli([...options, '-f', 'json'], source, 'cli')
  expect(json.code).toBe(0)
  for (const encoding of ['fast', 'standard'] as const) {
    const expected = render_png(JSON.parse(json.text), { encoding })
    const png = await cli([...options, '-f', 'png', '--png-encoding', encoding], source, 'cli')
    expect(png.code, png.error).toBe(0)
    expect(png.bytes).toEqual(new Uint8Array(expected))
    const kitty = await cli([...options, '--png-encoding', encoding], source, 'cli')
    expect(kitty.code, kitty.error).toBe(0)
    const encoded = [...kitty.text.matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].map(match => match[1]).join('')
    expect(new Uint8Array(Buffer.from(encoded, 'base64'))).toEqual(new Uint8Array(expected))
    if (encoding === 'fast') {
      const defaultPng = await cli([...options, '-f', 'png'], source, 'cli')
      expect(defaultPng.bytes).toEqual(png.bytes)
    }
  }
  const invalid = await cli([...options, '--png-encoding', 'invalid'], source, 'cli')
  expect(invalid.code).toBe(1)
  expect(invalid.text).toBe('')
  expect(invalid.error).toContain('Allowed choices')
})

test('direct PNG output preserves crop pixels, backgrounds, and full geometry without native addons', async () => {
  const source = '<Rect width="4px" height="4px" fill="red" stroke={none} />'
  const args = ['-f', 'png', '--select', '-1,-1,6,6', '--ratio', '2']
  for (const background of [undefined, 'blue']) {
    const result = await cli([...args, ...background ? ['--background', background] : []], source, 'cli')
    expect(result.code, result.error).toBe(0)
    const image = decode(result.bytes)
    expect([image.width, image.height]).toEqual([12, 12])
    expect([...image.data.slice(0, 4)]).toEqual(background ? [0, 0, 255, 255] : [0, 0, 0, 0])
    expect([...image.data.slice((3 * 12 + 3) * 4, (3 * 12 + 3) * 4 + 4)]).toEqual([255, 0, 0, 255])
  }
  const fraction = '<Rect width="1.25px" height="2.25px" fill="red" stroke={none} />'
  const rounded = await cli(['-f', 'png', '--precision', '0', '--ratio', '2'], fraction, 'cli')
  const full = await cli(['-f', 'png', '--precision', 'full', '--ratio', '2'], fraction, 'cli')
  expect(rounded.code, rounded.error).toBe(0)
  expect(rounded.bytes).toEqual(full.bytes)
  expect(png_size(rounded.bytes)).toEqual({ width: 3, height: 5 })
})

test('PNG and kitty outline text regardless of SVG text mode; emoji report an error', async () => {
  const source = '<Text>Text <Latex>x^2</Latex></Text>'
  const args: string[] = []
  for (const format of ['png', 'kitty']) {
    const path = await cli([...args, '-f', format, '--text-mode', 'path'], source, 'cli')
    const live = await cli([...args, '-f', format, '--text-mode', 'live'], source, 'cli')
    expect(live.code, live.error).toBe(0)
    expect(live.bytes).toEqual(path.bytes)
  }
  const output = join(scratch, 'emoji.png')
  await Bun.write(output, 'keep me')
  const result = await cli(['-o', output], '<Frame padding="4px"><Text>Hello 😀</Text></Frame>', 'cli')
  expect(result.code).toBe(1)
  expect(result.text).toBe('')
  expect(result.error).toContain('cannot draw live text')
  expect(await Bun.file(output).text()).toBe('keep me')
})

test('text mode supports live SVG and PDF prose and math, with optional outlines', async () => {
  const source = '<Text>Live <Span font-weight="bold">prose</Span> <Latex>x^2</Latex></Text>'
  const args = ['-f', 'svg', '-W', '320', '-H', '100']
  const standard = await cli(args, source, 'cli')
  const explicit = await cli([...args, '--text-mode', 'path'], source, 'cli')
  const live = await cli([...args, '--text-mode', 'live'], source, 'cli')
  for (const result of [standard, explicit, live]) expect(result.code, result.error).toBe(0)
  expect(explicit.text).toBe(standard.text)
  expect(standard.text).not.toContain('<text ')
  expect(live.text).toContain('<text ')
  expect(live.text).toContain('font-weight="700"')
  expect(live.text).toContain('>prose </text>')
  expect(live.text).toContain('font-family="KaTeX_Math"')
  expect(live.text).not.toContain('<path ')
  const png = await cli(['-f', 'png', '--text-mode', 'live', '-W', '320', '-H', '100'], source, 'cli')
  expect(png.code, png.error).toBe(0)
  expect(png_size(png.bytes)).toEqual({ width: 320, height: 100 })
  const pdf = await cli(['-f', 'pdf', '--text-mode', 'live'], source, 'cli')
  expect(pdf.code, pdf.error).toBe(0)
  expect(pdf.text).toStartWith('%PDF-')
  const outlinedPdf = await cli(['-f', 'pdf', '--text-mode', 'path'], source, 'cli')
  expect(outlinedPdf.code, outlinedPdf.error).toBe(0)
  expect(pdf.text).toContain('/FontFile2')
  expect(pdf.text).toContain('/ToUnicode')
  expect(outlinedPdf.text).not.toContain('/FontFile2')
  const invalid = await cli(['--text-mode', 'invalid'], '', 'cli')
  expect(invalid.code).toBe(1)
  expect(invalid.error).toContain('Allowed choices')
  expect(invalid.text).toBe('')
})

const pdfInputs = [
  { entry: 'cli', args: [], input: `<Svg width={px(160)} height={px(100)}>
    <VStack>
      <Text>Vector PDF</Text>
      <Latex>x^2</Latex>
    </VStack>
  </Svg>` },
]

test('gum emits binary PDF from the laid-out fragment with shared render options', async () => {
  for (const { entry, args, input } of pdfInputs) {
    for (const theme of [[], ['--theme', 'dark']]) {
      const options = [...args, ...theme]
      const json = await cli([...options, '-f', 'json', '--text-mode', 'live'], input, entry)
      expect(json.code).toBe(0)
      const fragment = JSON.parse(json.text) as Fragment
      const title = 'Gum (α) 🌱', background = '#369'
      const result = await cli([...options, '-f', 'pdf', '--title', title, '--background', background,
        '--ratio', '3', '--id-prefix', 'not an SVG identifier', '--stats'], input, entry)
      expect(result.code).toBe(0)
      expect(result.text).toStartWith('%PDF-1.4\n')
      expect(result.text).toContain('/MediaBox [0 0 120 75]')
      expect<Uint8Array>(result.bytes).toEqual(render_pdf(fragment, { title, background, fonts: createMathFonts() }))
      expect(JSON.parse(result.error).layouts).toBeGreaterThan(0)
    }
  }
})

test('precision flag controls SVG, PDF, and tree numbers and accepts full precision', async () => {
  const source = '<Svg width={px(1 / 3)} height={px(2)}><Rect width={px(0.1 + 0.2)} height={px(1)} /></Svg>'
  const rounded = await cli(['-f', 'svg', '--precision', '3'], source, 'cli')
  expect(rounded.code).toBe(0)
  expect(rounded.text).toContain('width="0.333"')
  expect(rounded.text).toContain('<rect x="0" y="0" width="0.3"')
  const full = await cli(['-f', 'svg', '--precision', 'full'], source, 'cli')
  expect(full.code).toBe(0)
  expect(full.text).toContain('width="0.3333333333333333"')
  expect(full.text).toContain('width="0.30000000000000004"')
  const pdf = await cli(['-f', 'pdf', '--precision', '3'], source, 'cli')
  expect(pdf.code).toBe(0)
  expect(pdf.text).toContain('/MediaBox [0 0 0.25 1.5]')
  const tree = await cli(['-f', 'tree', '--precision', '3'], source, 'cli')
  expect(tree.code).toBe(0)
  expect(tree.text).toContain('0.333×2')
  const defaultTree = await cli(['-f', 'tree'], source, 'cli')
  expect(defaultTree.text).toContain('0.3333333333×2')
  const fullTree = await cli(['-f', 'tree', '--precision', 'full'], source, 'cli')
  expect(fullTree.text).toContain('0.3333333333333333×2')
  const decimalSource = '<Svg width={px(123.45678)} height={px(2)} />'
  const decimalSvg = await cli(['-f', 'svg', '--precision', '3'], decimalSource, 'cli')
  expect(decimalSvg.code).toBe(0)
  expect(decimalSvg.text).toContain('width="123.457"')
  const decimalPdf = await cli(['-f', 'pdf', '--precision', '3'], decimalSource, 'cli')
  expect(decimalPdf.code).toBe(0)
  expect(decimalPdf.text).toContain('/MediaBox [0 0 92.593 1.5]')
  const decimalTree = await cli(['-f', 'tree', '--precision', '3'], decimalSource, 'cli')
  expect(decimalTree.code).toBe(0)
  expect(decimalTree.text).toContain('123.457×2')
  const whole = await cli(['-f', 'svg', '--precision', '0'], decimalSource, 'cli')
  expect(whole.code).toBe(0)
  expect(whole.text).toContain('width="123"')
  const maximum = await cli(['-f', 'svg', '--precision', '100'], source, 'cli')
  expect(maximum.code).toBe(0)
  expect(maximum.text).toContain('width="0.3333333333333333"')
  for (const value of ['-1', '101', '2.5', 'bogus']) {
    const invalid = await cli(['-f', 'svg', '--precision', value], source, 'cli')
    expect(invalid.code).toBe(1)
    expect(invalid.error).toContain('precision must be')
  }
})

test('gum infers PDF filenames and lets an explicit format override the extension', async () => {
  for (const { entry, args, input } of pdfInputs) {
    const stdout = await cli([...args, '-f', 'pdf'], input, entry)
    expect(stdout.code).toBe(0)
    expect(stdout.error).toBe('')
    for (const [file, format] of [[`${entry}.pdf`, []], [`${entry}-pdf.svg`, ['-f', 'pdf']]] as const) {
      const result = await cli([...args, '-o', file, ...format], input, entry)
      expect(result.code).toBe(0)
      expect(result.bytes.length).toBe(0)
      expect(result.error).toBe('')
      expect(new Uint8Array(await Bun.file(join(scratch, file)).arrayBuffer())).toEqual(stdout.bytes)
    }
    const svg = await cli([...args, '-o', `${entry}-svg.pdf`, '-f', 'svg'], input, entry)
    expect(svg.code).toBe(0)
    expect(await Bun.file(join(scratch, `${entry}-svg.pdf`)).text()).toStartWith('<svg ')
    const help = await cli(['--help'], '', entry)
    expect(help.text).toContain('"pdf"')
    expect(help.text).toContain('SVG, PDF, or PPTX document title')
  }
})

test('PDF errors reach stderr without emitting or overwriting output', async () => {
  for (const { entry, args, input } of pdfInputs) {
    const file = `${entry}-invalid.pdf`
    await Bun.write(join(scratch, file), 'existing file')
    for (const [options, message] of [
      [['-W', '0'], 'positive and finite'],
      [['--background', 'var(--paint)'], 'Unsupported PDF color'],
    ] as const) {
      const result = await cli([...args, '-f', 'pdf', '-o', file, ...options], input, entry)
      expect(result.code).toBe(1)
      expect(result.bytes.length).toBe(0)
      expect(result.error).toContain(message)
      expect(await Bun.file(join(scratch, file)).text()).toBe('existing file')
    }
  }
})

test('the JSX gum command retains SVG, raster, inspection, and math bindings', async () => {
  const jsx = 'return mathToElement(String.raw`\\frac{1}{2}`, { font_size: px(36) })'
  const result = await cli(['-f', 'svg'], jsx, 'cli')
  expect(result.code).toBe(0)
  expect(result.text === exportSvg(String.raw`\frac{1}{2}`, { font_size: px(36) }) + '\n').toBe(true)
  const square = '<Square width={px(40)} fill={blue} stroke={none} />'
  const raster = await cli(['-f', 'png', '-W', '80', '-H', '40', '--ratio', '2'], square, 'cli')
  expect(raster.code).toBe(0)
  expect(png_size(raster.bytes)).toEqual({ width: 160, height: 80 })
  expect((await cli(['-f', 'tree'], square, 'cli')).text).toContain('Square')
  expect(JSON.parse((await cli(['-f', 'json'], square, 'cli')).text).name).toBe('Svg')
})

test('JSX fallback offers size unsized canvases and preserve explicit and intrinsic sizing', async () => {
  const fragment = async (source: string, args: string[] = []) => {
    const result = await cli(['-f', 'json', ...args], source, 'cli')
    expect(result.code).toBe(0)
    expect(result.error).toBe('')
    return JSON.parse(result.text) as Fragment
  }
  const canvas = '<Group><Rect fill={blue} stroke={none} /></Group>'
  expect((await fragment(canvas)).size).toEqual({ width: 640, height: 480 })
  expect((await fragment('<Square width={px(40)} stroke={none} />')).size)
    .toEqual({ width: 40, height: 40 })
  expect((await fragment('<Text>Short</Text>')).size.width).toBeLessThan(100)
  expect((await fragment('<Box width={px(120)} height={px(700)} />')).size)
    .toEqual({ width: 120, height: 700 })
  expect((await fragment(canvas, ['-W', '200', '-H', '100'])).size)
    .toEqual({ width: 200, height: 100 })

  const aspect = '<Group aspect={2}><Rect stroke={none} /></Group>'
  expect((await fragment(aspect, ['-W', '300'])).size).toEqual({ width: 300, height: 150 })
  expect((await fragment(aspect, ['-H', '90'])).size).toEqual({ width: 180, height: 90 })
})

test('themes honor source selection, CLI overrides, and explicit JSX paints', async () => {
  const source = `<Svg theme="dark" width={px(90)} height={px(40)}>
    <HStack>
      <Text>Inherited</Text>
      <Text color="tomato">Explicit</Text>
    </HStack>
  </Svg>`
  await Bun.write(join(scratch, 'theme-deck', 'first.jsx'), source)
  await Bun.write(join(scratch, 'theme-deck', 'second.jsx'), source)
  for (const [args, theme] of [[[], 'dark'], [['--theme', 'light'], 'light']] as const) {
    const result = await cli(['-f', 'json', ...args], source, 'cli')
    expect(result.code).toBe(0)
    const fragment = JSON.parse(result.text) as Fragment
    expect(fragment.size).toEqual({ width: 90, height: 40 })
    expect(fragment.draw).toEqual([])
    const fills = drawings(fragment).filter(draw => draw.kind === 'path').map(draw => draw.fill)
    expect(fills).toContain(THEMES[theme].foreground)
    expect(fills).toContain('tomato')
    for (const inputs of [['theme-deck'], ['theme-deck/first.jsx', 'theme-deck/second.jsx']]) {
      const deck = await cli([...inputs, ...args, '--text-mode', 'path'], '', 'cli')
      expect(deck.code, deck.error).toBe(0)
      expect<Uint8Array>(deck.bytes).toEqual(render_pdf([fragment, fragment]))
    }
  }
  const transparent = await cli(['-f', 'json', '--background', 'none'], source, 'cli')
  expect(transparent.code).toBe(0)
  expect(JSON.parse(transparent.text).draw).toEqual([])
  const backdrop = await cli(['-f', 'svg', '--background', 'navy'], source, 'cli')
  expect(backdrop.code).toBe(0)
  expect(backdrop.text).toMatch(/<rect\b[^>]*fill="navy"/)
})

test('kitty defaults to dark for JSX while PNG defaults to light', async () => {
  const args: string[] = []
  const source = '<Text>Theme</Text>'
  const kitty = await cli(args, source, 'cli')
  expect(kitty.code).toBe(0)
  const encoded = [...kitty.text.matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].map(match => match[1]).join('')
  const dark = await cli([...args, '-f', 'png', '--theme', 'dark'], source, 'cli')
  expect(dark.code).toBe(0)
  expect(Buffer.from(encoded, 'base64').equals(Buffer.from(dark.bytes))).toBe(true)
  const light = await cli([...args, '-f', 'png'], source, 'cli')
  expect(light.code).toBe(0)
  expect(Buffer.from(light.bytes).equals(Buffer.from(dark.bytes))).toBe(false)
})

test('gum prints plain values returned by the source as text', async () => {
  const json = await cli(['-f', 'svg'], 'const x = 2\nreturn { x, list: [x, x * 21] }', 'cli')
  expect(json.code).toBe(0)
  expect(json.text).toBe('{\n  "x": 2,\n  "list": [\n    2,\n    42\n  ]\n}\n')
  const text = await cli([], 'return "plain text"', 'cli')
  expect(text.code).toBe(0)
  expect(text.text).toBe('plain text\n')
})

function pdf_title(pdf: string) {
  const hex = /\/Title <feff([0-9a-f]*)>/.exec(pdf)![1]!
  return Buffer.from(hex, 'hex').swap16().toString('utf16le')
}

function pdf_sizes(pdf: string) {
  return [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)]
    .map(match => [Number(match[1]), Number(match[2])])
}

const slide = (width: number, height = 40) => `<Svg width={px(${width})} height={px(${height})}>
  <Rect fill="red" />
</Svg>`

test('multiple JSX files render PDF pages in argument order', async () => {
  await Bun.write(join(scratch, 'multi-first.jsx'), slide(80))
  await Bun.write(join(scratch, 'multi-second.jsx'), slide(120))
  for (const options of [[], ['-f', 'pdf'], ['-o', 'multi.pdf'], ['-o', 'multi.svg', '-f', 'pdf']]) {
    const result = await cli(['multi-second.jsx', 'multi-first.jsx', '--title', 'Inline deck', ...options], '', 'cli')
    expect(result.code, result.error).toBe(0)
    expect(result.error).toBe('')
    const output = options.includes('-o') ? await Bun.file(join(scratch, options[1]!)).text() : result.text
    expect(output).toStartWith('%PDF-')
    expect(pdf_sizes(output)).toEqual([[90, 30], [60, 30]])
    expect(pdf_title(output)).toBe('Inline deck')
  }
})

test('invalid multiple inputs are rejected before evaluation or overwriting output', async () => {
  await Bun.write(join(scratch, 'first.jsx'), 'throw new Error("Unexpected evaluation")')
  await Bun.write(join(scratch, 'second.jsx'), slide(120))
  mkdirSync(join(scratch, 'extra-deck'))
  const output = join(scratch, 'extra-inputs.pdf')
  await Bun.write(output, 'keep me')
  for (const [inputs, message] of [
    [['first.jsx', 'second.jsx', '-f', 'svg'], 'require PDF or PPTX output'],
    [['first.jsx', 'extra-deck'], 'Cannot mix directories and files'],
    [['extra-deck', 'first.jsx'], 'Cannot mix directories and files'],
    [['extra-deck', 'extra-deck'], 'Cannot mix directories and files'],
    [['first.jsx', '-'], 'Cannot mix stdin with multiple files'],
    [['-', 'first.jsx'], 'Cannot mix stdin with multiple files'],
    [['-', '-'], 'Cannot mix stdin with multiple files'],
  ] as const) {
    const result = await cli([...inputs, '-o', output], slide(40), 'cli')
    expect(result.code).toBe(1)
    expect(result.error).toContain(message)
    expect(result.text).toBe('')
    expect(await Bun.file(output).text()).toBe('keep me')
  }
})

test('deck manifests order slides, set titles, and share a JSX prelude evaluated once', async () => {
  const dir = join(scratch, 'manifest-deck')
  mkdirSync(dir)
  await Bun.write(join(dir, 'index.json'), JSON.stringify({
    title: 'Ordered deck', prelude: 'prelude.jsx', slides: ['second.jsx', 'first.jsx'],
  }))
  await Bun.write(join(dir, 'prelude.jsx'), `
    let count = 0
    function Page({ width }) {
      return (
        <Svg width={px(width)} height={px(40 + ++count)}>
          <Latex>x^2</Latex>
        </Svg>
      )
    }
  `)
  await Bun.write(join(dir, 'first.jsx'), '<Page width={80} />')
  await Bun.write(join(dir, 'second.jsx'), 'const width = 120; return <Page width={width} />')
  const result = await cli(['manifest-deck', '-f', 'pdf', '--stats'], '', 'cli')
  expect(result.code).toBe(0)
  const stats = result.error.trim().split('\n').map(line => JSON.parse(line))
  expect(stats).toHaveLength(2)
  expect(stats.every(stat => stat.layouts > 0)).toBe(true)
  expect(pdf_sizes(result.text)).toEqual([[90, 30.75], [60, 31.5]])
  expect(pdf_title(result.text)).toBe('Ordered deck')
  const implicit = await cli(['manifest-deck'], '', 'cli')
  expect(implicit.code).toBe(0)
  expect(implicit.error).toBe('')
  expect(implicit.text).toStartWith('%PDF-')
  expect(pdf_sizes(implicit.text)).toEqual([[90, 30.75], [60, 31.5]])
  expect(pdf_title(implicit.text)).toBe('Ordered deck')
  const override = await cli(['manifest-deck', '-o', 'deck.pdf', '--title', 'Override', '-W', '200', '-H', '100'], '', 'cli')
  expect(override.code).toBe(0)
  expect(override.text).toBe('')
  const output = await Bun.file(join(scratch, 'deck.pdf')).text()
  expect(pdf_title(output)).toBe('Override')
  expect(pdf_sizes(output)).toEqual([[150, 75], [150, 75]])
  const single = await cli(['manifest-deck/first.jsx', '-f', 'svg'], '', 'cli')
  expect(single.code).toBe(1)
  expect(single.error).toContain('Page is not defined')
})

test('single files ignore neighboring manifests for SVG and PDF output', async () => {
  const dir = join(scratch, 'standalone-files')
  mkdirSync(dir)
  await Bun.write(join(dir, 'first.jsx'), slide(80))
  await Bun.write(join(dir, 'prelude.jsx'), 'throw new Error("Unexpected prelude")')
  for (const index of ['invalid JSON', JSON.stringify({ prelude: 'missing.jsx' }),
    JSON.stringify({ prelude: 'prelude.jsx' })]) {
    await Bun.write(join(dir, 'index.json'), index)
    const single = await cli(['standalone-files/first.jsx', '-f', 'svg'], '', 'cli')
    expect(single.code).toBe(0)
    expect(single.text).toContain('width="80" height="40"')
    const pdf = await cli(['standalone-files/first.jsx', '-f', 'pdf'], '', 'cli')
    expect(pdf.code).toBe(0)
    expect(pdf_sizes(pdf.text)).toEqual([[60, 30]])
  }
})

test('directories use natural JSX filename order and exclude a declared prelude', async () => {
  const dir = join(scratch, 'natural-deck')
  mkdirSync(dir)
  await Bun.write(join(dir, 'slide_10.jsx'), slide(100))
  await Bun.write(join(dir, 'slide_2.jsx'), slide(20))
  await Bun.write(join(dir, 'notes.txt'), 'not a slide')
  mkdirSync(join(dir, 'nested.jsx'))
  const result = await cli(['natural-deck', '-f', 'pdf'], '', 'cli')
  expect(result.code).toBe(0)
  expect(pdf_sizes(result.text)).toEqual([[15, 30], [75, 30]])
  await Bun.write(join(dir, 'prelude.jsx'), 'const unused = 42')
  await Bun.write(join(dir, 'index.json'), JSON.stringify({ prelude: 'prelude.jsx' }))
  const withPrelude = await cli(['natural-deck', '-f', 'pdf'], '', 'cli')
  expect(withPrelude.code).toBe(0)
  expect(withPrelude.bytes).toEqual(result.bytes)
})

test('invalid decks and unsupported deck output fail without overwriting output', async () => {
  const dir = join(scratch, 'invalid-deck'), output = join(scratch, 'protected.pdf')
  mkdirSync(dir)
  await Bun.write(output, 'keep me')
  await Bun.write(join(dir, 'good.jsx'), slide(40))
  await Bun.write(join(dir, 'bad.jsx'), 'return 42')
  for (const [manifest, message] of [
    [[], 'expected an object'],
    [{ title: 1 }, '"title" must be'],
    [{ prelude: false }, '"prelude" must be'],
    [{ slides: 'good.jsx' }, '"slides" must be'],
    [{ slides: [] }, 'no slides'],
    [{ slides: ['missing.jsx'] }, 'ENOENT'],
    [{ prelude: 'missing.jsx', slides: ['good.jsx'] }, 'ENOENT'],
    [{ slides: ['good.jsx', 'bad.jsx'] }, 'Deck slides must return a Gum element'],
  ] as const) {
    await Bun.write(join(dir, 'index.json'), JSON.stringify(manifest))
    const result = await cli(['invalid-deck', '-o', output], '', 'cli')
    expect(result.code).toBe(1)
    expect(result.text).toBe('')
    expect(result.error).toContain(message)
    expect(await Bun.file(output).text()).toBe('keep me')
  }
  for (const format of ['svg', 'png', 'kitty', 'tree', 'json']) {
    const result = await cli(['invalid-deck', '-f', format, '-o', output], '', 'cli')
    expect(result.code).toBe(1)
    expect(result.error).toContain('require PDF or PPTX output')
    expect(result.text).toBe('')
    expect(await Bun.file(output).text()).toBe('keep me')
  }
  for (const inputs of [['invalid-deck'], ['invalid-deck/good.jsx', 'invalid-deck/bad.jsx']]) {
    const inferred = await cli([...inputs, '-o', 'deck.svg'], '', 'cli')
    expect(inferred.code).toBe(1)
    expect(inferred.error).toContain('require PDF or PPTX output')
    expect(await Bun.file(join(scratch, 'deck.svg')).exists()).toBe(false)
  }
})

test('PPTX renders mixed text and vectors to stdout or inferred files with shared options', async () => {
  const source = `<Svg width={px(320)} height={px(180)}>
    <VStack>
      <Text>PowerPoint</Text>
      <Latex>x^2</Latex>
    </VStack>
  </Svg>`
  const json = await cli(['-f', 'json', '--text-mode', 'mixed'], source)
  expect(json.code, json.error).toBe(0)
  const options = { title: 'Gum & PowerPoint', background: '#eee', fonts: createMathFonts() }
  const expected = render_pptx(JSON.parse(json.text), options)
  const args = ['--title', options.title, '--background', options.background]
  const result = await cli(['-f', 'pptx', '--text-mode', 'mixed', '--stats', ...args], source)
  expect(result.code, result.error).toBe(0)
  expect<Uint8Array>(result.bytes).toEqual(expected)
  expect(JSON.parse(result.error).layouts).toBeGreaterThan(0)
  for (const [filename, format] of [['figure.pptx', []], ['pptx.svg', ['-f', 'pptx']]] as const) {
    const written = await cli(['-o', filename, ...format, ...args], source)
    expect(written.code, written.error).toBe(0)
    expect(written.bytes.length).toBe(0)
    expect<Uint8Array>(new Uint8Array(await Bun.file(join(scratch, filename)).arrayBuffer())).toEqual(expected)
  }
})

test('PPTX decks use argument order or the existing manifest, prelude, and title', async () => {
  const dir = join(scratch, 'pptx-deck')
  await Bun.write(join(dir, 'prelude.jsx'), 'const ink = "red"')
  const sources = [
    `<Svg width={px(320)} height={px(180)}>
      <Rect fill={ink} stroke="none" />
    </Svg>`,
    `<Svg width={px(320)} height={px(180)}>
      <Text>Second</Text>
    </Svg>`,
  ]
  await Bun.write(join(dir, 'first.jsx'), sources[0])
  await Bun.write(join(dir, 'second.jsx'), sources[1])
  await Bun.write(join(dir, 'index.json'), JSON.stringify({
    title: 'PPTX deck', prelude: 'prelude.jsx', slides: ['second.jsx', 'first.jsx'],
  }))
  const fragments = []
  for (const source of sources.toReversed()) {
    const json = await cli(['-f', 'json', '--text-mode', 'mixed'], 'const ink = "red";\nreturn ' + source)
    expect(json.code, json.error).toBe(0)
    fragments.push(JSON.parse(json.text) as Fragment)
  }
  const result = await cli(['pptx-deck', '-o', 'deck.pptx'])
  expect(result.code, result.error).toBe(0)
  expect<Uint8Array>(new Uint8Array(await Bun.file(join(scratch, 'deck.pptx')).arrayBuffer()))
    .toEqual(render_pptx(fragments, { title: 'PPTX deck', fonts: createMathFonts() }))
  const ordered = await cli(['pptx-deck/second.jsx', 'pptx-deck/second.jsx', '-f', 'pptx', '--title', 'Two'])
  expect(ordered.code, ordered.error).toBe(0)
  expect<Uint8Array>(ordered.bytes).toEqual(render_pptx([fragments[0], fragments[0]], { title: 'Two', fonts: createMathFonts() }))
})

test('PPTX rejects unsupported output without emitting bytes or replacing files', async () => {
  const output = join(scratch, 'protected.pptx')
  await Bun.write(output, 'keep me')
  for (const [source, message] of [
    ['<Svg width={px(20)} height={px(20)} />', '1–56 inches'],
  ]) {
    const result = await cli(['-o', output], source)
    expect(result.code).toBe(1)
    expect(result.bytes.length).toBe(0)
    expect(result.error).toContain(message)
    expect(await Bun.file(output).text()).toBe('keep me')
  }
  await Bun.write(join(scratch, 'small-slide.jsx'), '<Svg width={px(320)} height={px(180)} />')
  await Bun.write(join(scratch, 'large-slide.jsx'), '<Svg width={px(640)} height={px(360)} />')
  const mixed = await cli(['small-slide.jsx', 'large-slide.jsx', '-o', output])
  expect(mixed.code).toBe(1)
  expect(mixed.error).toContain('all slides must match')
  expect(await Bun.file(output).text()).toBe('keep me')
})

const video_source = `return {
  size: [64, 48], fps: 2, duration: 1,
  frame: ({time}) => <Svg background={lerp(0, 1, ease_in_out(progress(time, 0, 1))) > 0 ? 'blue' : 'red'} />,
}`

test('gum exports MP4 from stdin to stdout, inferred files, and explicit-format files', async () => {
  const streamed = await cli(['-f', 'mp4'], video_source)
  expect(streamed.code, streamed.error).toBe(0)
  expect(Buffer.from(streamed.bytes.subarray(4, 8)).toString()).toBe('ftyp')
  expect(streamed.error).toBe('')
  for (const [name, args] of [
    ['animation.mp4', []], ['animation.bin', ['-f', 'mp4']],
  ] as const) {
    const path = join(scratch, name)
    const saved = await cli([...args, '-o', path], video_source)
    expect(saved.code, saved.error).toBe(0)
    expect(saved.bytes.length).toBe(0)
    expect(new Uint8Array(await Bun.file(path).arrayBuffer())).toEqual(streamed.bytes)
  }
  const higher_quality = await cli(['-f', 'mp4', '--qp', '10'], video_source)
  expect(higher_quality.code, higher_quality.error).toBe(0)
})

test('gum previews video frames as Kitty and PNG with declared dimensions', async () => {
  const first = await cli(['-f', 'png'], video_source)
  expect(first.code, first.error).toBe(0)
  expect(png_size(first.bytes)).toEqual({ width: 64, height: 48 })
  expect([...decode(first.bytes).data.slice(0, 3)]).toEqual([255, 0, 0])
  const later = await cli(['-f', 'png', '--time', '0.75', '-W', '80', '-H', '60'], video_source)
  expect(later.code, later.error).toBe(0)
  expect(png_size(later.bytes)).toEqual({ width: 80, height: 60 })
  expect([...decode(later.bytes).data.slice(0, 3)]).toEqual([0, 0, 255])
  const kitty = await cli(['--time', '0.75', '-W', '80', '-H', '60'], video_source)
  expect(kitty.code, kitty.error).toBe(0)
  const encoded = [...kitty.text.matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].map(match => match[1]).join('')
  expect(new Uint8Array(Buffer.from(encoded, 'base64'))).toEqual(later.bytes)
})

test('video export honors viewport, theme, and background overrides', async () => {
  const source = `return { size:[64,48], fps:2, duration:1,
    frame:() => <Rect width={px(20)} height={px(20)} fill="theme:foreground" /> }`
  const result = await cli(['-f', 'mp4', '-W', '80', '-H', '60', '--theme', 'dark', '-b', '#123456'], source)
  expect(result.code, result.error).toBe(0)
  const { render_mp4, evaluate_mp4 } = await import('@gum-jsx/mp4')
  const expected: Uint8Array[] = []
  const video = evaluate_mp4(`return { size:[80,60], fps:2, duration:1, background:'#123456',
    frame:() => <Svg theme="dark"><Rect width={px(20)} height={px(20)} fill="theme:foreground" /></Svg> }`)
  await render_mp4(video, bytes => { expected.push(bytes) })
  expect(result.bytes).toEqual(new Uint8Array(Buffer.concat(expected)))
})

test('gum validates MP4 and frame-preview options', async () => {
  for (const args of [
    ['-f', 'mp4', '--qp', '9'], ['-f', 'mp4', '--qp', '18.5'],
    ['-f', 'png', '--qp', '18'], ['-f', 'mp4', '--time', '0'],
    ['-f', 'mp4', '--ratio', '2'], ['-f', 'mp4', '--select', '0,0,2,2'],
    ['-f', 'mp4', '--stats'], ['--time', '1'], ['--time', '-1'],
    ['-f', 'mp4', '-W', '65'],
  ]) {
    const result = await cli(args, video_source)
    expect(result.code, args.join(' ')).toBe(1)
    expect(result.bytes.length).toBe(0)
  }
  expect((await cli(['--time', '0'], '<Circle />')).code).toBe(1)
  expect((await cli(['-f', 'mp4'], '<Circle />')).code).toBe(1)
})

test('failed MP4 export preserves the destination', async () => {
  const output = join(scratch, 'existing.mp4')
  await Bun.write(output, 'existing')
  const result = await cli(['-o', output], `return {
    size:[64,48], fps:2, duration:1,
    frame:({frame}) => { if (frame) throw new Error('frame failure'); return <Circle /> },
  }`)
  expect(result.code).toBe(1)
  expect(result.error).toContain('frame failure')
  expect(await Bun.file(output).text()).toBe('existing')
})
