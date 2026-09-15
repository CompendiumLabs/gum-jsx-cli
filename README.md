# gum-next-cli

The Bun command-line interface for Gum. `gum` reads JSX and `gum-tex` reads TeX.
It lays out the
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
check all packages. Run `bun test` here for command integration tests, also included in the
workspace test command.

The protocol encoders in [src/kitty.ts](./src/kitty.ts) accept PNG or raw RGBA
data, with image/placement IDs, terminal columns/rows, cursor movement, and
virtual-placement controls. Unicode placeholder text generation is still pending.

PDF, watch mode, themes, and deck workflows remain
tracked in [FEATURES.md](../docs/FEATURES.md#command-line-and-authoring-workflows).

## Standalone TeX

```sh
bun run gum-tex 'e^{i\pi}+1=0' -o /tmp/euler.svg
bun run gum-tex '\frac{a+b}{c+d}' -S 48 -p 0.25 -o /tmp/fraction.png --ratio 2
bun run gum-tex -i formula.tex --inline -f tree --stats
printf '%s\n' '\int_0^1 x^2\,dx=\frac13' | bun run gum-tex -f svg
bun run gum-tex 'x^2' --fit -W 320
bun run gum-tex --help
```

The workspace also installs `node_modules/.bin/gum-tex`. Its positional argument
is literal TeX. Omit it or use `-` for stdin; use `-i` / `--input` for a file.
Literal input and `--input` are mutually exclusive. Supply formula contents
without `$` or `$$` delimiters. Quote shell input with single quotes to preserve
backslashes; use `--` before a formula starting with a dash.

All output options above apply to both commands. TeX adds:

| Option | Meaning |
|---|---|
| `-S, --font-size <pixels>` | Positive base em, default `24`. |
| `-p, --padding <em>` | Nonnegative padding on each side, default `0`. |
| `--inline` | Text style; the default is display style. |
| `--no-strut` | Omit the minimum formula line box. |
| `--color <color>` | Formula color, default black. |
| `--macro <command=tex>` | Repeatable definition, such as `'\RR=\mathbb{R}'`. |
| `--fit` | Uniformly fit the completed formula into `-W` and/or `-H`. |

Natural exports use `mathToElement` from `gum-next-math`: logical space and all
visible ink are included, with negative extents translated into the viewport.
Empty axes have a one-pixel floor. This preserves italic overhang, accents,
laps, and smashed ink without changing their typographic advance inside other
layouts. Both commands then share layout, inspection, SVG, PNG, and kitty output.

Font size controls typography. `-W` / `-H` alone change the clipping viewport;
`--fit` explicitly scales the formula and requires at least one dimension.
`--ratio` controls raster resolution independently. Errors retain the formula's
layout path and TeX source range when available; malformed and unsupported TeX
exit with status 1. No JavaScript evaluation is used for TeX input.

See the [standalone export guide](../gum-next-docs/topics/text/MathExport.md) for
synchronous/asynchronous library helpers and font-resource ownership.
