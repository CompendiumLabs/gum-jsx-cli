import { Evaluator } from '@gum-jsx/core'
import * as math from '@gum-jsx/math'

// Math is bundled with the CLI; additional plugins come from the caller's project.
async function create_evaluator(plugins: readonly string[] = []): Promise<Evaluator> {
  let scope: Record<string, unknown> = { ...math }
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
