import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { px, em, THEMES } from 'gum-jsx-core'
import type { Fragment } from 'gum-jsx-core'
import { mathToSvg } from 'gum-jsx-math'

const texDefaults = { font_size: px(64) } as const
const exportSvg = mathToSvg
function drawings(fragment: Fragment): Fragment['draw'][number][] {
  return [...fragment.draw, ...fragment.children.flatMap(child => drawings(child.fragment))]
}
const scratch = mkdtempSync(join(tmpdir(), 'gum-jsx-cli-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
async function cli(args: string[], input = '', entry = 'tex') {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL(`../src/${entry}.ts`, import.meta.url)), ...args], {
    stdin: new Blob([input]), stdout: 'pipe', stderr: 'pipe', cwd: scratch,
  })
  const [code, bytes, error] = await Promise.all([child.exited,
    new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text()])
  return { code, bytes: new Uint8Array(bytes), text: new TextDecoder().decode(bytes), error }
}
function png_size(bytes: Uint8Array) {
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

test('gum-tex literal, file, and stdin match the library SVG', async () => {
  const tex = String.raw`\mathllap{x}\int_0^\infty e^{-t}\,dt`
  await Bun.write(join(scratch, 'formula.tex'), tex)
  const expected = exportSvg(tex, { font_size: px(40), padding: em(0.25), color: 'navy' }) + '\n'
  for (const args of [[tex], ['-i', 'formula.tex'], [], ['-'], ['-i', '-']]) {
    const result = await cli([...args, '-f', 'svg', '-s', '40', '-p', '0.25', '--color', 'navy'], tex)
    expect(result.code).toBe(0)
    expect(result.error).toBe('')
    expect(result.text === expected).toBe(true)
  }
})

test('gum-tex modes, macros, SVG metadata, and stats reach the shared renderer', async () => {
  const tex = String.raw`\RR\to\f{x}`
  const result = await cli([tex, '-f', 'svg', '--inline', '--no-strut', '--macro', String.raw`\RR=\mathbb{R}`,
    '--macro', String.raw`\f=\frac{#1}{2}`, '--title', 'A < B & C', '--background', 'white', '--id-prefix', 'tex', '--stats'])
  expect(result.code).toBe(0)
  const expected = exportSvg(tex, { inline: true, strut: false,
    macros: { '\\RR': String.raw`\mathbb{R}`, '\\f': String.raw`\frac{#1}{2}` },
    title: 'A < B & C', background: 'white', id_prefix: 'tex', ...texDefaults }) + '\n'
  expect(result.text === expected).toBe(true)
  expect(JSON.parse(result.error).layouts).toBeGreaterThan(0)
  const tree = await cli(['x^2', '-f', 'tree'])
  expect(tree.code).toBe(0)
  expect(tree.text).toContain('MathViewport')
  const json = await cli(['x^2', '-f', 'json'])
  expect(json.code).toBe(0)
  expect(JSON.parse(json.text).children[0].fragment.children[0].fragment.label).toBe('x^2')
})

test('PNG dimensions follow the fractional SVG viewport and kitty encodes the same PNG', async () => {
  const text = String.raw`\smash{\widehat{ABC}}`
  const svg = mathToSvg(text, { strut: false, ...texDefaults })
  const [, width, height] = /width="([\d.]+)" height="([\d.]+)"/.exec(svg)!
  const png = await cli([text, '--no-strut', '-f', 'png', '--ratio', '2'])
  expect(png.code).toBe(0)
  expect(png_size(png.bytes)).toEqual({ width: Math.ceil(Number(width) * 2), height: Math.ceil(Number(height) * 2) })
  const kitty = await cli([text, '--no-strut', '--ratio', '2', '--theme', 'light'])
  expect(kitty.code).toBe(0)
  const encoded = [...kitty.text.matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].map(match => match[1]).join('')
  expect(new Uint8Array(Buffer.from(encoded, 'base64'))).toEqual(png.bytes)
  const empty = await cli(['', '--no-strut', '-f', 'png'])
  expect(empty.code).toBe(0)
  expect(png_size(empty.bytes)).toEqual({ width: 1, height: 1 })
})

test('output extensions and explicit formats work for file output', async () => {
  expect((await cli(['x', '-o', 'formula.svg'])).code).toBe(0)
  expect((await Bun.file(join(scratch, 'formula.svg')).text()) === exportSvg('x', texDefaults) + '\n').toBe(true)
  expect((await cli(['x', '-o', 'formula.png'])).code).toBe(0)
  png_size(new Uint8Array(await Bun.file(join(scratch, 'formula.png')).arrayBuffer()))
  expect((await cli(['x', '-o', 'override.png', '-f', 'svg'])).code).toBe(0)
  expect((await Bun.file(join(scratch, 'override.png')).text()).startsWith('<svg ')).toBe(true)
})

test('viewport clipping and explicit uniform fitting are distinct', async () => {
  const plain = JSON.parse((await cli(['x+y', '-f', 'json'])).text)
  const clipped = JSON.parse((await cli(['x+y', '-W', '5', '-f', 'json'])).text)
  expect(clipped.size.width).toBe(5)
  expect(clipped.size.height).toBe(plain.size.height)
  expect(clipped.overflow.right).toBeGreaterThan(0)
  const fit = JSON.parse((await cli(['x+y', '--fit', '-W', '200', '-f', 'json'])).text)
  expect(fit.size.width).toBe(200)
  expect(fit.size.height).toBeCloseTo(plain.size.height * 200 / plain.size.width, 8)
  expect(fit.children[0].fragment.children[0].transform[0]).toBeCloseTo(200 / plain.size.width, 8)
  const box = JSON.parse((await cli(['x+y', '--fit', '-W', '200', '-H', '100', '-f', 'json'])).text)
  expect(box.size).toEqual({ width: 200, height: 100 })
})

test('errors return status 1 without output and help documents the input contract', async () => {
  const failures: [string[], string][] = [
    [['{', '-f', 'svg'], 'parse:'], [[String.raw`\phase{x}`, '-f', 'svg'], 'unsupported:'],
    [['x', '-i', 'formula.tex'], 'not both'], [['--fit', 'x'], 'requires'],
    [['x', '-s', '0'], 'positive'], [['x', '-s', 'NaN'], 'finite'], [['x', '-p', '-1'], 'nonnegative'],
    [['x', '--macro', 'invalid'], 'macro must'], [['x', '--ratio', '0'], 'positive'],
    [['x', '-o', 'unknown.xyz'], 'Unknown format'], [['-i', 'missing.tex'], 'ENOENT'],
    [['x', '-W', '0', '-f', 'png'], 'positive'],
    [['x', '--theme', 'sepia'], 'Allowed choices'],
  ]
  for (const [args, message] of failures) {
    const result = await cli(args)
    expect(result.code).toBe(1)
    expect(result.text).toBe('')
    expect(result.error).toContain(message)
  }
  const help = await cli(['--help'])
  expect(help.code).toBe(0)
  expect(help.text).toContain('Literal TeX')
  expect(help.text).toContain('--fit')
  expect(help.text).toContain('-t, --theme <theme>')
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

test('themes honor source selection, CLI overrides, and explicit JSX paints', async () => {
  const source = `<Svg theme="dark" width={px(90)} height={px(40)}>
    <HStack>
      <Text>Inherited</Text>
      <Text color="tomato">Explicit</Text>
    </HStack>
  </Svg>`
  for (const [args, theme] of [[[], 'dark'], [['--theme', 'light'], 'light']] as const) {
    const result = await cli(['-f', 'json', ...args], source, 'cli')
    expect(result.code).toBe(0)
    const fragment = JSON.parse(result.text) as Fragment
    expect(fragment.size).toEqual({ width: 90, height: 40 })
    expect(fragment.draw).toEqual([])
    const fills = drawings(fragment).filter(draw => draw.kind === 'path').map(draw => draw.fill)
    expect(fills).toContain(THEMES[theme].foreground)
    expect(fills).toContain('tomato')
  }
  const transparent = await cli(['-f', 'json', '--background', 'none'], source, 'cli')
  expect(transparent.code).toBe(0)
  expect(JSON.parse(transparent.text).draw).toEqual([])
  const backdrop = await cli(['-f', 'svg', '--background', 'navy'], source, 'cli')
  expect(backdrop.code).toBe(0)
  expect(backdrop.text).toMatch(/<rect\b[^>]*fill="navy"/)
})

test('TeX defaults to light exports and lets theme or color override the foreground', async () => {
  for (const [args, foreground] of [
    [[], 'black'],
    [['--theme', 'light'], 'black'],
    [['--theme', 'dark'], 'white'],
    [['-t', 'dark'], 'white'],
    [['--theme', 'dark', '--color', 'navy'], 'navy'],
  ] as const) {
    const result = await cli(['x^2', '-f', 'json', ...args])
    expect(result.code).toBe(0)
    const fragment = JSON.parse(result.text) as Fragment
    expect(fragment.draw).toEqual([])
    const glyphs = drawings(fragment).filter(draw => draw.kind === 'path')
    expect(glyphs.length).toBeGreaterThan(0)
    expect(glyphs.every(draw => draw.fill === foreground)).toBe(true)
  }
})

test('TeX backgrounds are optional render options independent of the theme', async () => {
  for (const theme of ['light', 'dark']) {
    const args = ['x^2', '--theme', theme]
    const transparent = await cli([...args, '-f', 'svg'])
    expect(transparent.code).toBe(0)
    expect(transparent.text).not.toMatch(/<rect\b[^>]*fill=/)
    const painted = await cli([...args, '-f', 'svg', '--background', 'navy'])
    expect(painted.code).toBe(0)
    expect(painted.text).toContain('fill="navy"')
    expect(painted.text).toMatch(new RegExp(`<path\\b[^>]*fill="${theme === 'dark' ? 'white' : 'black'}"`))
    const tree = await cli([...args, '-f', 'json', '--background', 'navy'])
    expect(tree.code).toBe(0)
    expect(JSON.parse(tree.text).draw).toEqual([])
  }
})

test('kitty defaults to dark for both JSX and TeX while PNG defaults to light', async () => {
  for (const entry of ['cli', 'tex']) {
    const args = entry === 'tex' ? ['x^2'] : []
    const source = entry === 'cli' ? '<Text>Theme</Text>' : ''
    const kitty = await cli(args, source, entry)
    expect(kitty.code).toBe(0)
    const encoded = [...kitty.text.matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].map(match => match[1]).join('')
    const dark = await cli([...args, '-f', 'png', '--theme', 'dark'], source, entry)
    expect(dark.code).toBe(0)
    expect(Buffer.from(encoded, 'base64').equals(Buffer.from(dark.bytes))).toBe(true)
    const light = await cli([...args, '-f', 'png'], source, entry)
    expect(light.code).toBe(0)
    expect(Buffer.from(light.bytes).equals(Buffer.from(dark.bytes))).toBe(false)
  }
})
