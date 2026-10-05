import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../', import.meta.url))
// Build dependencies whose code/assets ship in the CLI and need notices.
export const bundled_dependencies = [
  'commander', 'papaparse', '@gum-jsx/core', '@gum-jsx/math', '@gum-jsx/maps',
  '@gum-jsx/pdf', '@gum-jsx/pptx', '@gum-jsx/png', '@gum-jsx/mp4',
]

// Match acorn-jsx's CommonJS entry to avoid bundling a second Acorn parser.
const acorn = createRequire(import.meta.resolve('@gum-jsx/core')).resolve('acorn')
export function bundle_options(): Bun.BuildConfig {
  return {
    entrypoints: [resolve(root, 'src/bundled.ts')],
    target: 'bun',
    minify: { whitespace: true, syntax: true, identifiers: false },
    plugins: [{
      name: 'deduplicate-acorn',
      setup(build) {
        build.onResolve({ filter: /^acorn$/ }, () => ({ path: acorn }))
      },
    }],
  }
}
