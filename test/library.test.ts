import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create_cli, create_evaluator, layout, render } from '../src'
import { version } from '../package.json'

const scratch = await mkdtemp(join(tmpdir(), 'gum-cli-library-'))
afterAll(() => rm(scratch, { recursive: true, force: true }))

// Imports must not consume stdin, parse argv, register plugins, or run a command.
test('importing the library leaves command execution to the caller', async () => {
  const entry = join(scratch, 'import.ts')
  const library = new URL('../src/index.ts', import.meta.url).href
  await Bun.write(entry, `
    import { run_cli } from ${JSON.stringify(library)}
    if (typeof run_cli !== 'function') throw new Error('Missing command API')
    console.log('imported')
  `)
  const child = Bun.spawn([process.execPath, entry, '--unknown-option'], {
    stdin: new Blob(['throw new Error("Unexpected evaluation")']),
    stdout: 'pipe', stderr: 'pipe',
  })
  const [code, out, err] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  expect({ code, out, err }).toEqual({ code: 0, out: 'imported\n', err: '' })
})

test('callers can evaluate, lay out, and render without a command', async () => {
  const evaluator = await create_evaluator()
  const element = evaluator.evaluate('<Square width={px(40)} fill="tomato" />')
  const result = layout(element, {})
  const output = join(scratch, 'figure.svg')
  render(result, 'svg', { output, ratio: 1, idPrefix: 'library' })
  const svg = await readFile(output, 'utf8')
  expect(svg).toContain('width="40" height="40"')
  expect(svg).toContain('tomato')
})

test('commands use caller versions and do not share parsed options', async () => {
  const input = join(scratch, 'value.jsx')
  await Bun.write(input, 'return "hello"')
  const first = create_cli('9.8.7')
  const second = create_cli('1.2.3')
  await first.parseAsync([input, '-f', 'svg', '-W', '123', '-o', join(scratch, 'first.txt')], { from: 'user' })
  await second.parseAsync([input, '-f', 'svg', '-o', join(scratch, 'second.txt')], { from: 'user' })
  expect(first.version()).toBe('9.8.7')
  expect(second.version()).toBe('1.2.3')
  expect(first.opts().width).toBe(123)
  expect(second.opts().width).toBeUndefined()
  expect(await readFile(join(scratch, 'second.txt'), 'utf8')).toBe('hello\n')
})

test('published library ships source and runtime dependencies without executables', async () => {
  const child = Bun.spawn([
    'npm', 'pack', '--ignore-scripts', '--pack-destination', scratch,
    '--cache', join(scratch, 'cache'),
  ], { cwd: join(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe' })
  const [code, out, err] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  expect(code, out + err).toBe(0)
  const files = await new Bun.Archive(
    await readFile(join(scratch, `gum-jsx-cli-${version}.tgz`)),
  ).files()
  const pkg = JSON.parse(await files.get('package/package.json')!.text())
  expect(pkg.bin).toBeUndefined()
  expect(pkg.scripts.prepack).toBeUndefined()
  expect(pkg.exports['.']).toBe('./src/index.ts')
  expect(pkg.exports['./kitty']).toBe('./src/kitty.ts')
  expect(pkg.dependencies['@gum-jsx/core']).toBe(version)
  expect(pkg.dependencies.commander).toBeDefined()
  expect(pkg.dependencies.papaparse).toBeDefined()
  expect(files.has('package/src/index.ts')).toBe(true)
  expect([...files.keys()].some(name => /^package\/(dist|scripts|test)\//.test(name))).toBe(false)
}, 30_000)
