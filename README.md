# gum-next-cli

The Bun command-line interface for `gum-next-core`. It reads gum JSX, lays out the
result, and displays it with kitty graphics by default. SVG, PNG, fragment-tree,
and JSON output are also available. Commander supplies argument parsing and
generated help. File and terminal I/O live here; evaluation, layout, SVG serialization, and fragment
inspection use the core's public API. [gum-next-png](../gum-next-png/README.md)
provides PNG conversion through node-canvas.

From the workspace root:

```sh
bun install
bun run gum --help
bun run gum gum-next-docs/elements/code/Frame.jsx
bun run gum gum-next-docs/elements/code/Frame.jsx -f tree --stats
bun run gum gum-next-docs/topics/code/repeated.jsx -o /tmp/repeated.svg
bun run gum gum-next-docs/elements/code/Box.jsx -W 220 -o /tmp/card.png --ratio 2
bun run gum gum-next-docs/elements/code/Group.jsx -W 640 -H 320
printf '%s\n' '<Square width={px(40)} fill="tomato"/>' | bun run gum -f svg
```

The package also exposes a `gum` executable at `node_modules/.bin/gum` in the
workspace. Inside this package, use `bun run gum [file.jsx] [options]`. Input and
output paths are relative to the directory where you run the command.

```text
Usage: gum [options] [file]

Arguments:
  file                   JSX file (omit or use - for stdin)

Options:
  -f, --format <format>  Output format (default: kitty or output extension)
                         (choices: "kitty", "svg", "png", "tree", "json")
  -o, --output <file>    Write output to a file instead of stdout
  -W, --width <pixels>   Set the viewport width
  -H, --height <pixels>  Set the viewport height
  --ratio <number>       PNG/kitty sampling ratio (default: 1)
  --background <color>   Paint the viewport background
  --title <text>         Add an escaped SVG title
  --id-prefix <name>     Prefix SVG definition IDs (default: "gum")
  --stats                Print layout counters to stderr
  -h, --help             display help for command
```

Omit the input file or use `-` to read stdin. A bare element is wrapped in `Svg`.
`-W` / `--width` and `-H` / `--height` are independent pixel overrides; `-h`
remains the help shortcut. Omitted axes retain source
sizing or hug the content. Zero is a valid viewport dimension for SVG, tree, and
JSON; PNG and kitty require positive dimensions. The sampling ratio must be
positive and changes raster sampling without changing layout. Raster dimensions
round up to whole pixels.

An explicit format takes precedence over the output filename. Otherwise the
output extension selects the format; stdout defaults to kitty, including when
redirected or piped, matching the original gum command. Use `-f svg` for SVG on
stdout, or `-o figure.svg` / `-o figure.png` to select a file format automatically.
Kitty output displays inline in terminals that support the kitty graphics
protocol and ends with a newline. An explicit `-f kitty` or an output filename
ending in `.kitty` writes the same graphics sequence.

PNG and kitty use the workspace's node-canvas dependency through `gum-next-png`,
loaded only for these formats. Text is already SVG glyph paths, so no font
registration is needed.
Errors go to stderr and exit with status 1. For machine-readable
`--stats`, run the executable directly or use `bun run --silent gum` to suppress
Bun's script announcement.

Run `bun run typecheck` here to check the CLI, or from the workspace root to
check all packages. The CLI has no test suite; the workspace's `bun run test`
runs the core suite.

The protocol encoders in [src/kitty.ts](./src/kitty.ts) accept PNG or raw RGBA
data, with image/placement IDs, terminal columns/rows, cursor movement, and
virtual-placement controls. Unicode placeholder text generation is still pending.

PDF, watch mode, themes, TeX, and deck workflows remain
tracked in [FEATURES.md](../docs/FEATURES.md#command-line-and-authoring-workflows).
