import { Evaluator } from '@gum-jsx/core'
import * as math from '@gum-jsx/math'
import * as maps from '@gum-jsx/maps'
import { lerp, progress, ease_in_out } from '@gum-jsx/mp4'

// Math and maps are bundled with the CLI; additional plugins come from the caller's project.
async function create_evaluator(plugins: readonly string[] = []): Promise<Evaluator> {
  if (plugins.length && typeof Bun === 'undefined') {
    throw new Error('CLI plugins require Bun. Run this CLI with Bun: bun '
      + JSON.stringify(process.argv[1]) + ' <files...> --plugin <module>')
  }
  let scope: Record<string, unknown> = { ...math, ...maps, lerp, progress, ease_in_out }
  for (const plugin of plugins) {
    try {
      const entry = Bun.resolveSync(plugin, process.cwd())
      // Only named exports become bindings; "default" is not a JavaScript variable name.
      const { default: _default, ...bindings } = await import(entry)
      scope = { ...scope, ...bindings }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new Error(`Cannot load plugin ${JSON.stringify(plugin)}: ${message}`, { cause })
    }
  }
  return new Evaluator({ scope })
}

export { create_evaluator }
