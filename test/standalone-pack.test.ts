import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pack_standalone } from '../scripts/standalone-pack'
import { version } from '../package.json'

test('release archives preserve binaries, permissions, notices, and checksums across partial updates', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'gum-pack-test-'))
  try {
    const binary = join(scratch, 'input'), output = join(scratch, 'release')
    await Bun.write(binary, 'first build\n')
    await pack_standalone([
      { target: 'bun-linux-x64', outfile: binary },
      { target: 'bun-windows-x64', outfile: binary },
    ], output)
    const linux = `gum-v${version}-linux-x64`
    const windows = `gum-v${version}-windows-x64`
    const archive = new Bun.Archive(await readFile(join(output, `${linux}.tar.gz`)))
    const files = await archive.files()
    expect(await files.get(`${linux}/gum`)!.text()).toBe('first build\n')
    expect(await files.get(`${linux}/README.txt`)!.text()).toContain('No Bun installation')
    expect(files.has(`${linux}/LICENSE`)).toBe(true)
    expect([...files.keys()].some(name => name.endsWith('/OFL.txt'))).toBe(true)
    expect([...files.keys()].some(name => name.includes('@gum-jsx__png') && name.endsWith('/THIRD_PARTY_NOTICES.md'))).toBe(true)
    const extracted = join(scratch, 'extracted')
    await archive.extract(extracted)
    if (process.platform !== 'win32') expect((await stat(join(extracted, linux, 'gum'))).mode & 0o777).toBe(0o755)
    const zip = Bun.spawn(['unzip', '-p', join(output, `${windows}.zip`), `${windows}/gum.exe`], { stdout: 'pipe' })
    expect(await new Response(zip.stdout).text()).toBe('first build\n')
    expect(await zip.exited).toBe(0)

    const windowsBefore = await readFile(join(output, `${windows}.zip`))
    await Bun.write(binary, 'second build\n')
    await pack_standalone([{ target: 'bun-linux-x64', outfile: binary }], output)
    expect(await readFile(join(output, `${windows}.zip`))).toEqual(windowsBefore)
    expect((await readdir(output)).sort()).toEqual(['SHA256SUMS', `${linux}.tar.gz`, `${windows}.zip`].sort())
    const sums = await readFile(join(output, 'SHA256SUMS'), 'utf8')
    for (const line of sums.trim().split('\n')) {
      const [hash, name] = line.split('  ')
      expect(hash).toBe(createHash('sha256').update(await readFile(join(output, name))).digest('hex'))
    }
    const updated = await new Bun.Archive(await readFile(join(output, `${linux}.tar.gz`))).files()
    expect(await updated.get(`${linux}/gum`)!.text()).toBe('second build\n')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}, 30_000)
