# @gum-jsx/cli

[Gum](https://github.com/CompendiumLabs/gum-jsx) — installation, quickstart, and user documentation.

Command construction, JSX evaluation, layout, and rendering APIs for Gum.
This is a source library for Bun or a compatible server-side bundler.
Importing it does not parse arguments, consume stdin, or run a command.

The `gum-jsx` package owns executable entry points, npm bundles, standalone
builds, and release archives. `@gum-jsx/cli` ships TypeScript source with its
runtime dependencies and exposes no executable.

## Use the library

```sh
bun add @gum-jsx/cli
```

Create an entry point with an explicit version and arguments:

```ts
import { run_cli } from '@gum-jsx/cli'

await run_cli(process.argv.slice(2), '2.0.0')
```

`run_cli(args, version)` accepts user arguments without the runtime or script
name. It writes command output, reports errors to stderr, and sets the process
exit code on rendering failures. Commander retains its normal exit behavior
for help, version, and argument errors. Each call creates a fresh command.

For custom command handling, `create_cli(version)` returns an unparsed
Commander `Command`. Configure it before calling
`parseAsync(args, { from: 'user' })`; use Commander's `exitOverride()` when the
caller needs to handle command exits itself.

The evaluation and rendering APIs can also be used independently:

```ts
import { create_evaluator, layout, render } from '@gum-jsx/cli'

const evaluator = await create_evaluator()
const element = evaluator.evaluate('<Square width={px(40)} fill="tomato" />')
const result = layout(element, {})
render(result, 'svg', { output: 'figure.svg', ratio: 1, idPrefix: 'gum' })
```

The root export also includes `file_loaders`, `layout_deck`, `render_deck`,
and the `LayoutOptions`, `RenderOptions`, and `DeckIndex` types.
`create_evaluator(plugins)` provides core, math, maps, video helpers, and local
file loaders; optional plugins resolve from the caller's working directory.
File access, rendering output, and plugin loading happen when these APIs run.

The existing `@gum-jsx/cli/kitty` export provides PNG and raw RGBA terminal
protocol encoders without importing command construction or renderers.

## Development and visual reports

Run `bun run test` for import, API, and library packaging checks, and
`bun run typecheck` for TypeScript checks. Executable integration and fresh
installation tests live in `../gum-jsx/test` and run with that package's suite.

From the workspace root, `bun run visual-test` evaluates the documentation
examples and focused visual regression cases. It checks evaluation, layout,
viewports, geometry, and drawings, then writes a searchable report to
`gum-jsx-cli/visual-report/dist/index.html`.

`bun run visual-report` is an alias. Open the HTML directly or run
`bun --filter @gum-jsx/cli visual-report:serve` for an HTTP preview. Pass
`--output /some/directory` after the report script to change its destination.
See [visual-report/README.md](visual-report/README.md).
