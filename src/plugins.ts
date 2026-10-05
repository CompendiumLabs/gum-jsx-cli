import { Evaluator } from '@gum-jsx/core'
import * as math from '@gum-jsx/math'
import * as maps from '@gum-jsx/maps'
import { Video, lerp, progress, ease_in_out } from '@gum-jsx/mp4'
import { file_loaders } from './files'
import type { EvaluateOptions } from '@gum-jsx/core'

// Fresh loaders retain each source's directory; plugins and explicit bindings can override them.
function file_options(options: EvaluateOptions, defaults: EvaluateOptions): EvaluateOptions {
  const loaders = file_loaders(options.name ?? defaults.name)
  return { ...options, scope: { ...loaders, ...defaults.scope, ...options.scope } }
}

// Math and maps are bundled with the CLI; additional plugins come from the caller's project.
async function create_evaluator(plugins: readonly string[] = []): Promise<Evaluator> {
  if (plugins.length && typeof Bun === 'undefined') {
    throw new Error('CLI plugins require Bun. Run this CLI with Bun: bun '
      + JSON.stringify(process.argv[1]) + ' <files...> --plugin <module>')
  }
  let scope: Record<string, unknown> = { ...math, ...maps, Video, lerp, progress, ease_in_out }
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
  return new CliEvaluator({ scope })
}

// Keep file access in the CLI while sharing core evaluation and prelude behavior.
class CliEvaluator extends Evaluator {
  override evaluate(code: string, options: EvaluateOptions = {}): any {
    return super.evaluate(code, file_options(options, this))
  }

  override evaluate_prelude(code: string, options: EvaluateOptions = {}): Record<string, unknown> {
    return super.evaluate_prelude(code, file_options(options, this))
  }
}

export { create_evaluator }
