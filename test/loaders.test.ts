import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, encode } from 'fast-png'

const scratch = mkdtempSync(join(tmpdir(), 'gum-jsx-loaders-'))
const entry = process.env.GUM_CLI_ENTRY ?? fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])
const png = encode({ width: 2, height: 1, channels: 4, data: pixels })
const image = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

// Run the same cases against source, the npm bundle under Node, and the Bun bundle.
let invocation = 0
async function cli(args: string[], input = '') {
  const output = join(scratch, `stdout-${++invocation}`)
  const errors = join(scratch, `stderr-${invocation}`)
  const child = Bun.spawn([
    process.env.GUM_CLI_RUNTIME ?? process.execPath, '--no-addons', entry, ...args,
  ], {
    cwd: scratch, stdin: new Blob([input]), stdout: Bun.file(output), stderr: Bun.file(errors),
    env: process.env.GUM_CLI_RUNTIME ? { ...process.env, PATH: '' } : process.env,
  })
  const code = await child.exited
  const [bytes, error] = await Promise.all([
    Bun.file(output).arrayBuffer(), Bun.file(errors).text(),
  ])
  return { code, bytes: new Uint8Array(bytes), text: new TextDecoder().decode(bytes), error }
}

test('loaders resolve relative and absolute files from the JSX source directory', async () => {
  const dir = join(scratch, 'figure data')
  const config = { title: 'External data', count: 2 }
  await Bun.write(join(dir, 'config.json'), JSON.stringify(config))
  await Bun.write(join(dir, 'data.csv'), '\ufeffid,value,label,active\r\n'
    + '001,2.5,"first, row",true\r\n002,3,"line one\r\nline two",false\r\n\r\n')
  await Bun.write(join(dir, 'photo.png'), png)
  await Bun.write(join(dir, 'figure.jsx'), `return {
    config: loadJSON('./config.json'),
    absolute: loadJSON(${JSON.stringify(join(dir, 'config.json'))}),
    rows: loadCSV('./data.csv'),
    image: loadPNG('./photo.png'),
  }`)
  const result = await cli(['figure data/figure.jsx'])
  expect(result.code, result.error).toBe(0)
  expect(result.error).toBe('')
  expect(JSON.parse(result.text)).toEqual({ config, absolute: config, image, rows: [
    { id: 1, value: 2.5, label: 'first, row', active: true },
    { id: 2, value: 3, label: 'line one\r\nline two', active: false },
  ] })

  // Check that the unmodified bytes embed in SVG and decode in raster output.
  await Bun.write(join(dir, 'image.jsx'), '<PngImage data={loadPNG("./photo.png")} width={px(2)} />')
  const svg = await cli(['figure data/image.jsx', '-f', 'svg'])
  expect(svg.code, svg.error).toBe(0)
  expect(svg.text).toContain(image)
  const raster = await cli(['figure data/image.jsx', '-f', 'png'])
  expect(raster.code, raster.error).toBe(0)
  const decoded = decode(raster.bytes)
  expect([decoded.width, decoded.height]).toEqual([2, 1])
  expect([...decoded.data]).toEqual([...pixels])
})

test('stdin loaders use cwd, JSON accepts all value types, and CSV accepts one column', async () => {
  const values = [{ key: 1 }, [2, 3], 'text', 42, false, null]
  for (const [index, value] of values.entries()) {
    await Bun.write(join(scratch, `value-${index}.json`), JSON.stringify(value))
  }
  await Bun.write(join(scratch, 'single.csv'), 'value\n7\n')
  await Bun.write(join(scratch, 'stdin.png'), png)
  const source = `return {
    values: Array.from({ length: 6 }, (_, index) => loadJSON('value-' + index + '.json')),
    rows: loadCSV('single.csv'),
    image: loadPNG('stdin.png'),
  }`
  for (const args of [[], ['-']]) {
    const result = await cli(args, source)
    expect(result.code, result.error).toBe(0)
    expect(JSON.parse(result.text)).toEqual({ values, rows: [{ value: 7 }], image })
  }
})

test('CSV options preserve text or select typed columns with a different delimiter', async () => {
  await Bun.write(join(scratch, 'options.csv'), 'id;value;active\n001;2.5;true\n')
  await Bun.write(join(scratch, 'empty.csv'), '')
  await Bun.write(join(scratch, 'headers.csv'), 'id,value\n')
  const result = await cli([], `return [
    loadCSV('options.csv', { delimiter: ';', dynamicTyping: false }),
    loadCSV('options.csv', { delimiter: ';', dynamicTyping: { value: true } }),
    loadCSV('options.csv', { delimiter: ';', dynamicTyping: column => column !== 'id' }),
    loadCSV('empty.csv'),
    loadCSV('headers.csv'),
  ]`)
  expect(result.code, result.error).toBe(0)
  expect(JSON.parse(result.text)).toEqual([
    [{ id: '001', value: '2.5', active: 'true' }],
    [{ id: '001', value: 2.5, active: 'true' }],
    [{ id: '001', value: 2.5, active: true }],
    [], [],
  ])
})

test('file failures identify the resolved filename and preserve existing output', async () => {
  const output = join(scratch, 'protected.svg')
  await Bun.write(output, 'keep me')
  const cases = [
    ['loadJSON', 'bad.json', '{', 'JSON'],
    ['loadCSV', 'bad.csv', 'a,b\n1\n', 'TooFewFields'],
    ['loadCSV', 'quote.csv', 'a,b\n1,"unclosed', 'MissingQuotes'],
    ['loadPNG', 'bad.png', 'not a PNG', 'PNG'],
  ]
  for (const [loader, file, data, message] of cases) {
    await Bun.write(join(scratch, file!), data!)
    const result = await cli(['-o', output], `return ${loader}(${JSON.stringify(file)})`)
    expect(result.code).toBe(1)
    expect(result.text).toBe('')
    expect(result.error).toContain(join(scratch, file!))
    expect(result.error).toContain(message!)
    expect(await Bun.file(output).text()).toBe('keep me')
  }
  for (const loader of ['loadJSON', 'loadCSV', 'loadPNG']) {
    const result = await cli([], `return ${loader}('missing.file')`)
    expect(result.code).toBe(1)
    expect(result.error).toContain(join(scratch, 'missing.file'))
    expect(result.error).toContain('ENOENT')
  }
})

test('deck preludes and slides retain their own loader directories', async () => {
  const dir = join(scratch, 'deck')
  await Bun.write(join(dir, 'index.json'), JSON.stringify({
    prelude: 'shared/prelude.jsx', slides: ['one/slide.jsx', 'two/slide.jsx'],
  }))
  await Bun.write(join(dir, 'shared', 'height.json'), '40')
  await Bun.write(join(dir, 'shared', 'prelude.jsx'), `
    const height = loadJSON('./height.json')
    function Page({ width }) {
      const extra = loadJSON('./height.json')
      return <Svg width={px(width)} height={px(height + extra)} />
    }
  `)
  for (const [folder, width] of [['one', 80], ['two', 120]] as const) {
    await Bun.write(join(dir, folder, 'width.csv'), `value\n${width}\n`)
    await Bun.write(join(dir, folder, 'slide.jsx'), '<Page width={loadCSV("./width.csv")[0].value} />')
  }
  const result = await cli(['deck'])
  expect(result.code, result.error).toBe(0)
  const sizes = [...result.text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)]
    .map(match => [Number(match[1]), Number(match[2])])
  expect(sizes).toEqual([[60, 60], [90, 60]])
})

test('video frame functions retain source-relative loaders after evaluation', async () => {
  await Bun.write(join(scratch, 'video', 'color.json'), '"red"')
  await Bun.write(join(scratch, 'video', 'source.jsx'), `return {
    size: [2, 1], fps: 1, duration: 1,
    frame: () => <Svg background={loadJSON('./color.json')} />,
  }`)
  const result = await cli(['video/source.jsx', '--time', '0', '-f', 'svg'])
  expect(result.code, result.error).toBe(0)
  expect(result.text).toContain('fill="red"')
})
