import { chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { bundle_options, root } from './bundle'
import { licenses } from './licenses'

// Keep npm artifacts separate from standalone executables and release archives.
const outdir = join(root, 'dist/npm')
await rm(outdir, { recursive: true, force: true })
const result = await Bun.build({
  ...bundle_options(), target: 'node', outdir, naming: { entry: 'cli.js' },
})
if (!result.success) throw new AggregateError(result.logs, 'CLI bundle failed')
await chmod(join(outdir, 'cli.js'), 0o755)
await licenses(join(outdir, 'licenses'))
