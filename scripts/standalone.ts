import { Command } from 'commander'
import { fileURLToPath } from 'node:url'
import { pack_standalone } from './standalone-pack'

const defaults = [
  { target: 'bun-darwin-arm64', outfile: 'dist/gum-macos-arm64' },
  { target: 'bun-windows-x64', outfile: 'dist/gum-windows-x64.exe' },
  { target: 'bun-linux-x64', outfile: 'dist/gum-linux-x64' },
]

const program = new Command()
  .description('Build standalone gum executables. Defaults to macOS ARM64, Windows x64, and Linux x64.')
  .option('--target <target>', 'Build one Bun target, or "native" for the installed runtime')
  .option('--outfile <path>', 'Override the output path (requires --target)')
  .option('--archive', 'Package builds in dist/releases/v<version> with SHA256SUMS')
  .parse()
const options = program.opts<{ target?: string; outfile?: string; archive?: boolean }>()
if (options.outfile && !options.target) program.error('--outfile requires --target')

function output_name(target: string): string {
  if (target === 'native') return `dist/gum${process.platform === 'win32' ? '.exe' : ''}`
  const known = defaults.find(build => build.target === target)
  if (known) return known.outfile
  return `dist/gum-${target.replace(/^bun-/, '')}${target.split('-').includes('windows') ? '.exe' : ''}`
}

const builds = options.target
  ? [{ target: options.target, outfile: options.outfile ?? output_name(options.target) }]
  : defaults

for (const { target, outfile } of builds) {
  console.log(`Building ${target} → ${outfile}`)
  // Bun 1.4.2 can reuse the host runtime for an identical target, including
  // distro-specific shared libraries. This alias selects the official download.
  const compileTarget = target === 'bun-linux-x64' ? 'bun-linux-x64-baseline' : target
  const child = Bun.spawn([
    process.execPath, 'build', '--compile', '--minify-whitespace', '--minify-syntax',
    'src/cli.ts', '--outfile', outfile,
    ...target === 'native' ? [] : ['--target', compileTarget],
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
  })
  const code = await child.exited
  if (code !== 0) process.exit(code)
}

if (options.archive) await pack_standalone(builds)
