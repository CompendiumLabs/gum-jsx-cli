import { afterAll, beforeAll, expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scratch = mkdtempSync(join(tmpdir(), 'gum-standalone-'))
const root = fileURLToPath(new URL('../', import.meta.url))
const binary = join(scratch, process.platform === 'win32' ? 'gum.exe' : 'gum')

beforeAll(async () => {
  if (process.env.GUM_STANDALONE_BINARY) {
    copyFileSync(process.env.GUM_STANDALONE_BINARY, binary)
    return
  }
  const build = Bun.spawn([process.execPath, 'run', 'standalone:build', '--target', 'native', '--outfile', binary], {
    cwd: root, stdout: 'pipe', stderr: 'pipe',
  })
  const [code, output, error] = await Promise.all([
    build.exited, new Response(build.stdout).text(), new Response(build.stderr).text(),
  ])
  expect(code, output + error).toBe(0)
}, 30_000)

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

async function render(standalone: boolean, args: string[], source = '') {
  const command = standalone ? [binary] : [process.execPath, join(root, 'src/cli.ts')]
  const child = Bun.spawn([...command, ...args], {
    cwd: scratch,
    env: { ...process.env, PATH: '', NODE_PATH: '', BUN_OPTIONS: '' },
    stdin: new Blob([source]), stdout: 'pipe', stderr: 'pipe',
  })
  const [code, bytes, error] = await Promise.all([
    child.exited, new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(),
  ])
  expect(code, error).toBe(0)
  expect(error).toBe('')
  return new Uint8Array(bytes)
}

test('standalone embeds text, math, map data, and rasterizer with matching output', async () => {
  const source = `
    <Svg width={px(240)} height={px(160)}>
      <VStack>
        <Text>Hello <Span font-weight="bold">Gum</Span></Text>
        <Latex>{String.raw\`\\frac{1}{\\sqrt{x}}\`}</Latex>
        <GeoMap source={world_countries()} width={px(120)} height={px(60)} />
      </VStack>
    </Svg>
  `
  for (const format of ['svg', 'png', 'pdf', 'kitty', 'tree', 'json']) {
    const args = ['-f', format]
    expect(await render(true, args, source)).toEqual(await render(false, args, source))
  }
  // Check bundled text and math output on a slide with explicit dimensions.
  const pptx = `<Svg width={px(320)} height={px(180)}>
    <VStack>
      <Text>PowerPoint</Text>
      <Latex>x^2</Latex>
    </VStack>
  </Svg>`
  expect(await render(true, ['-f', 'pptx'], pptx)).toEqual(await render(false, ['-f', 'pptx'], pptx))
  // The metrics-only fallback font must also be embedded.
  const emoji = '<Text>Hello 😀</Text>'
  expect(await render(true, ['-f', 'svg'], emoji)).toEqual(await render(false, ['-f', 'svg'], emoji))
}, 30_000)

test('standalone reads files, writes output, and renders decks outside the workspace', async () => {
  await Bun.write(join(scratch, 'slides/one.jsx'), '<Text>First slide</Text>')
  await Bun.write(join(scratch, 'slides/two.jsx'), '<Latex>x^2</Latex>')
  expect(await render(true, ['slides'])).toEqual(await render(false, ['slides']))
  await render(true, ['slides/one.jsx', '-o', 'one.svg'])
  expect(new Uint8Array(await Bun.file(join(scratch, 'one.svg')).arrayBuffer()))
    .toEqual(await render(false, ['slides/one.jsx', '-f', 'svg']))
})

test('standalone embeds the MP4 encoder and previews video frames without external tools', async () => {
  const video = `return {
    size:[64,48], fps:2, duration:1,
    frame:({time}) => <Svg background={time ? 'blue' : 'red'} />,
  }`
  expect(await render(true, ['-f', 'mp4'], video)).toEqual(await render(false, ['-f', 'mp4'], video))
  expect(await render(true, ['--time', '0.5', '-f', 'png'], video))
    .toEqual(await render(false, ['--time', '0.5', '-f', 'png'], video))
})

test('standalone loads local TypeScript and installed package plugins', async () => {
  await Bun.write(join(scratch, 'helper.ts'), 'export const twice = (n: number) => n * 2')
  await Bun.write(join(scratch, 'node_modules/palette/package.json'),
    JSON.stringify({ name: 'palette', type: 'module', exports: './index.ts' }))
  await Bun.write(join(scratch, 'node_modules/palette/index.ts'), "export const accent = 'tomato'")
  const args = ['--plugin', './helper.ts', '--plugin', 'palette', '-f', 'svg']
  const source = '<Square width={px(twice(20))} fill={accent} />'
  expect(await render(true, args, source)).toEqual(await render(false, args, source))
})
