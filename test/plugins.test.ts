import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scratch = mkdtempSync(join(tmpdir(), 'gum-jsx-plugins-'))
const entry = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const core = pathToFileURL(Bun.resolveSync('@gum-jsx/core', import.meta.dir)).href
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

async function cli(args: string[], input = '') {
  const child = Bun.spawn([process.execPath, entry, ...args], {
    cwd: scratch, stdin: new Blob([input]), stdout: 'pipe', stderr: 'pipe',
  })
  const [code, text, error] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  return { code, text, error }
}

test('local TypeScript plugins expose named exports while retaining core and math', async () => {
  const plugin = join(scratch, 'elements kit.ts')
  await Bun.write(plugin, `
    export { Rect as PluginRect } from ${JSON.stringify(core)}
    export const accent = await Promise.resolve('tomato')
    export const twice = (value: number) => value * 2
    export default { ignored: true }
  `)
  const source = `
    <Svg width={px(twice(24))} height={px(20)}>
      <HStack>
        <PluginRect fill={accent} stroke={none} />
        <Latex>x^2</Latex>
      </HStack>
    </Svg>
  `
  await Bun.write(join(scratch, 'figures', 'figure.jsx'), source)
  // The plugin path is relative to cwd, even when the input lives in a subdirectory.
  const file = await cli(['figures/figure.jsx', '--plugin', './elements kit.ts', '-f', 'svg'])
  expect(file.code, file.error).toBe(0)
  expect(file.text).toContain('width="48" height="20"')
  expect(file.text).toContain('fill="tomato"')
  const stdin = await cli(['-', '--plugin', plugin, '-f', 'svg'], source)
  expect(stdin.code, stdin.error).toBe(0)
  expect(stdin.text).toBe(file.text)
})

test('packages resolve from the caller project and later plugin bindings win', async () => {
  const pkg = join(scratch, 'node_modules', 'gum-test-plugin')
  await Bun.write(join(pkg, 'package.json'), JSON.stringify({
    name: 'gum-test-plugin', type: 'module', exports: { '.': './index.ts', './extra': './extra.ts' },
  }))
  await Bun.write(join(pkg, 'index.ts'), `
    export const shared = 'package'
    export const package_value = 12
    export const pi = 3
  `)
  await Bun.write(join(pkg, 'extra.ts'), `
    export const shared = 'subpath'
    export const extra_value = 24
  `)
  await Bun.write(join(scratch, 'override.ts'), `
    export const shared = 'local'
    export const mathToElement = () => 'override'
  `)
  const result = await cli([
    '--plugin', 'gum-test-plugin', '--plugin', 'gum-test-plugin/extra', '--plugin', './override.ts',
  ], 'return [shared, package_value, extra_value, pi, typeof Svg, typeof Latex, mathToElement()]')
  expect(result.code, result.error).toBe(0)
  expect(JSON.parse(result.text)).toEqual(['local', 12, 24, 3, 'function', 'function', 'override'])
  const reversed = await cli(['--plugin', './override.ts', '--plugin', 'gum-test-plugin'], 'return shared')
  expect(reversed.code, reversed.error).toBe(0)
  expect(reversed.text).toBe('package\n')
})

test('deck preludes and slides share the loaded plugin instance', async () => {
  await Bun.write(join(scratch, 'deck-elements.ts'), `
    export { Rect as PluginRect } from ${JSON.stringify(core)}
    let count = 0
    export const next = () => ++count
    export const page_width = 80
  `)
  await Bun.write(join(scratch, 'deck', 'index.json'), JSON.stringify({
    prelude: 'prelude.jsx', slides: ['first.jsx', 'second.jsx'],
  }))
  await Bun.write(join(scratch, 'deck', 'prelude.jsx'), `
    const height = 39 + next()
    function Page({ width }) {
      return (
        <Svg width={px(width)} height={px(height)}>
          <PluginRect fill={blue} stroke={none} />
        </Svg>
      )
    }
  `)
  for (const file of ['first.jsx', 'second.jsx']) {
    await Bun.write(join(scratch, 'deck', file), '<Page width={page_width + next()} />')
  }
  const result = await cli(['deck', '--plugin', './deck-elements.ts'])
  expect(result.code, result.error).toBe(0)
  expect(result.text).toStartWith('%PDF-')
  const sizes = [...result.text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)]
    .map(match => [Number(match[1]), Number(match[2])])
  expect(sizes).toEqual([[61.5, 30], [62.25, 30]])
})

test('plugin loading failures identify the module and preserve existing output', async () => {
  const output = join(scratch, 'protected.svg')
  await Bun.write(output, 'keep me')
  await Bun.write(join(scratch, 'broken.ts'), 'throw new Error("Plugin setup failed")')
  for (const plugin of ['./missing.ts', 'gum-plugin-not-installed', './broken.ts']) {
    const result = await cli(['--plugin', plugin, '-o', output], 'throw new Error("Source ran")')
    expect(result.code).toBe(1)
    expect(result.text).toBe('')
    expect(result.error).toContain(`Cannot load plugin ${JSON.stringify(plugin)}`)
    if (plugin === './broken.ts') expect(result.error).toContain('Plugin setup failed')
    expect(await Bun.file(output).text()).toBe('keep me')
  }
})
