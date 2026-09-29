import { chmod, copyFile, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { version } from '../package.json'

const root = fileURLToPath(new URL('../', import.meta.url))
type Build = { target: string; outfile: string }

async function command(args: string[], cwd: string) {
  const child = Bun.spawn(args, { cwd, stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error(`${args[0]} failed while creating release archives`)
}

// Include installed runtime dependency licenses, plus bundled font/data notices.
async function licenses(destination: string) {
  const seen = new Set<string>()
  async function visit(directory: string) {
    directory = await realpath(directory)
    if (seen.has(directory)) return
    seen.add(directory)
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    const output = join(destination, `${pkg.name.replaceAll('/', '__')}@${pkg.version}`)
    for (const relative of ['', 'src/fonts', 'data']) {
      const source = join(directory, relative)
      let entries
      try { entries = await readdir(source, { withFileTypes: true }) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      for (const entry of entries) {
        if (!entry.isFile() || !/(license|notice|copying|^ofl)/i.test(entry.name)) continue
        const target = join(output, relative, entry.name)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(join(source, entry.name), target)
      }
    }
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      let current = directory
      while (true) {
        const candidate = join(current, 'node_modules', name)
        try { await stat(join(candidate, 'package.json')) }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          const parent = dirname(current)
          if (parent === current) throw new Error(`Cannot find dependency notices for ${name}`)
          current = parent
          continue
        }
        await visit(candidate)
        break
      }
    }
  }
  await visit(root)
}

export async function pack_standalone(builds: readonly Build[],
  destination = join(root, 'dist', 'releases', `v${version}`)) {
  destination = resolve(destination)
  await mkdir(destination, { recursive: true })
  const scratch = await mkdtemp(join(tmpdir(), 'gum-release-'))
  try {
    const common = join(scratch, 'common')
    await mkdir(common)
    await copyFile(join(root, 'LICENSE'), join(common, 'LICENSE'))
    await licenses(join(common, 'licenses'))
    await Bun.write(join(common, 'THIRD_PARTY_NOTICES.md'), `# Third-party notices

The licenses directory contains notices from Gum's installed runtime dependencies,
including its bundled fonts, map data, and PNG renderer.

The executable also embeds Bun. Bun's runtime license and linked-library notices:
https://github.com/oven-sh/bun/blob/bun-v${Bun.version}/LICENSE.md
Source and build instructions: https://github.com/oven-sh/bun/tree/bun-v${Bun.version}
Gum source: https://github.com/CompendiumLabs/gum-jsx
`)
    for (const build of builds) {
      const target = build.target === 'native'
        ? `bun-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`
        : build.target
      const platform = target.replace(/^bun-/, '').replace(/^darwin-/, 'macos-')
      const windows = target.split('-').includes('windows')
      const name = `gum-v${version}-${platform}`
      const directory = join(scratch, name)
      await mkdir(directory)
      const executable = windows ? 'gum.exe' : 'gum'
      await copyFile(resolve(root, build.outfile), join(directory, executable))
      await chmod(join(directory, executable), 0o755)
      await Bun.write(join(directory, 'README.txt'), `Gum ${version} — ${platform}

Extract this archive and put ${executable} in a directory on your PATH.
${windows ? 'Run .\\gum.exe --help in PowerShell to get started.' : 'For example: mkdir -p "$HOME/.local/bin" && cp gum "$HOME/.local/bin/gum"\nEnsure $HOME/.local/bin is on your PATH. Run ./gum --help to get started.'}

Render a JSX file: ${executable} figure.jsx -o figure.svg
No Bun installation is required. External plugins need their own dependencies.
${platform.startsWith('linux-') && !platform.includes('musl') ? 'This Linux build requires glibc.\n' : ''}
Documentation: https://compendiumlabs.ai/gum/docs
Source: https://github.com/CompendiumLabs/gum-jsx
`)
      await cp(common, directory, { recursive: true })
      const filename = `${name}.${windows ? 'zip' : 'tar.gz'}`
      const staged = join(scratch, filename)
      if (windows) await command(['zip', '-q', '-r', '-X', staged, name], scratch)
      else await command(['tar', '-czf', staged, '-C', scratch, name], scratch)
      await copyFile(staged, join(destination, filename))
      console.log(`Packaged ${join(destination, filename)}`)
    }
    // Recompute all archives in this version directory so selected-target runs
    // keep checksums for the other platforms too.
    const filenames = (await readdir(destination)).filter(name =>
      name.startsWith(`gum-v${version}-`) && /\.(tar\.gz|zip)$/.test(name)).sort()
    const sums = []
    for (const name of filenames) {
      const hash = createHash('sha256').update(await readFile(join(destination, name))).digest('hex')
      sums.push(`${hash}  ${name}\n`)
    }
    await Bun.write(join(destination, 'SHA256SUMS'), sums.join(''))
    console.log(`Release assets: ${destination}`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
