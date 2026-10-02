import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { version } from '../package.json'

const root = fileURLToPath(new URL('../', import.meta.url))

test('npm package installs offline and runs under Node and Bun, with Bun-only plugins', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'gum-npm-test-'))
  try {
    async function command(args: string[], cwd: string, env = process.env) {
      const child = Bun.spawn(args, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
      const [code, out, err] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ])
      expect(code, `${args.join(' ')}\n${out}\n${err}`).toBe(0)
      return out
    }
    // Exercise the publication lifecycle, including building from source.
    await command([
      'npm', 'pack', '--pack-destination', scratch, '--cache', join(scratch, 'cache'),
    ], root)
    const tarball = join(scratch, `gum-jsx-cli-${version}.tgz`)
    const archive = await new Bun.Archive(await readFile(tarball)).files()
    const files = [...archive.keys()].map(file => file.replace(/^package\//, ''))
    expect(files).toContain('dist/npm/cli.js')
    expect(files.some(file => file.endsWith('.ttf'))).toBe(true)
    expect(files.some(file => file.endsWith('/OFL.txt'))).toBe(true)
    expect(files.some(file => file.includes('@gum-jsx__png') && file.endsWith('/THIRD_PARTY_NOTICES.md'))).toBe(true)
    expect(files.some(file => file.includes('@gum-jsx__mp4') && file.endsWith('/THIRD_PARTY_NOTICES.md'))).toBe(true)
    expect(files.filter(file => file.startsWith('src/'))).toEqual(['src/kitty.ts'])
    expect(files.some(file => file.startsWith('test/'))).toBe(false)
    expect(files.every(file => !file.startsWith('dist/') || file.startsWith('dist/npm/'))).toBe(true)

    const consumer = join(scratch, 'consumer')
    await mkdir(consumer)
    await Bun.write(join(consumer, 'package.json'), '{"name":"gum-consumer","private":true}')
    await command(['npm', 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      '--cache', join(scratch, 'cache'), tarball], consumer)
    const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'))
    expect(Object.keys(lock.packages).sort()).toEqual(['', 'node_modules/@gum-jsx/cli'])
    const entry = join(consumer, 'node_modules/.bin/gum')
    expect(await Bun.file(entry).text()).toStartWith('#!/usr/bin/env node')
    const node = process.env.GUM_NODE_RUNTIME ?? Bun.which('node')
    expect(node).not.toBeNull()
    await command([process.execPath, 'test', 'test/cli.test.ts'], root, {
      ...process.env, GUM_CLI_ENTRY: entry, GUM_CLI_RUNTIME: node!,
    })
    const output = join(consumer, 'keep.svg')
    await Bun.write(output, 'keep me')
    const rejectionOut = join(scratch, 'node-stdout')
    const rejectionErr = join(scratch, 'node-stderr')
    const rejected = Bun.spawn([node!, entry, '--plugin', './missing.ts', '-o', output], {
      cwd: consumer, env: { ...process.env, PATH: '' },
      stdin: 'ignore', stdout: Bun.file(rejectionOut), stderr: Bun.file(rejectionErr),
    })
    const code = await rejected.exited
    const [stdout, stderr] = await Promise.all([
      Bun.file(rejectionOut).text(), Bun.file(rejectionErr).text(),
    ])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('CLI plugins require Bun')
    expect(stderr).toContain('bun ')
    expect(await Bun.file(output).text()).toBe('keep me')

    await command([process.execPath, 'test', 'test/cli.test.ts', 'test/plugins.test.ts'], root, {
      ...process.env, GUM_CLI_ENTRY: entry,
    })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}, 120_000)
