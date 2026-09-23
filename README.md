# @gum-jsx/cli

Command-line rendering for Gum. `gum` reads JSX, `gum-tex` renders a TeX formula,
and `gum-mark` displays Markdown with embedded figures and math. Render to SVG,
PNG, or PDF, display kitty terminal graphics, or inspect layout as a tree or JSON.

See the [Gum project](https://github.com/CompendiumLabs/gum-jsx#readme) for
getting started and the package overview.

## Quick start

Save a Gum JSX figure as `figure.jsx`, then run:

```sh
bun run gum --help
bun run gum figure.jsx
bun run gum figure.jsx -f tree --stats
bun run gum figure.jsx -o figure.svg
bun run gum figure.jsx -o figure.pdf
bun run gum figure.jsx -W 220 -o figure.png --ratio 2
bun run gum figure.jsx -W 640 -H 320
printf '%s\n' '<Square width={px(40)} fill="tomato"/>' | bun run gum -f svg
```

Input and output paths are relative to the directory where you run the command.

## JSX options

```text
Usage: gum [options] [file]

Arguments:
  file                   JSX file (omit or use - for stdin)

Options:
  -f, --format <format>          Output format (default: kitty or output extension)
                         (choices: "kitty", "svg", "png", "pdf", "tree", "json")
  -o, --output <file>            Write output to a file instead of stdout
  -W, --width <pixels>           Set the viewport width
  -H, --height <pixels>          Set the viewport height
  --natural                      Measure without the default 640 × 480 offer (JSX only)
  -r, --ratio <number>           PNG/kitty sampling ratio (default: 1)
  --select <x,y,width,height>    Crop PNG/kitty to a box in source pixels
  -b, --background <color>       Paint the viewport background
  -t, --theme <theme>            light or dark (default: source theme, or dark for kitty / light otherwise)
  --title <text>                 Set the SVG or PDF document title
  --id-prefix <name>             Prefix SVG definition IDs (default: "gum")
  --precision <digits|full>      Output decimal places (0–100; default: 10)
  --stats                        Print layout counters to stderr
  -h, --help                     display help for command
```

Omit the input file or use `-` to read stdin. A bare element is wrapped in `Svg`.
`-W` / `--width` and `-H` / `--height` are independent pixel overrides; `-h`
remains the help shortcut. With neither override, `gum` offers 640 × 480 pixels
so unsized canvases can render. This is an advisory budget: explicit source sizes
still win, short content hugs, and tall documents can grow vertically. Use
`--natural` to disable this fallback. With either override, the other axis retains
source sizing or hugs content, allowing `-W 320` to reflow a document and an
aspect ratio to determine a figure's height. `gum-tex` retains natural sizing.
Zero is a valid viewport dimension for SVG, tree, and
JSON; PNG, PDF, and kitty require positive dimensions. The sampling ratio must be
positive and changes raster sampling without changing layout. Raster dimensions
round up to whole pixels.

Use `--select 100,50,200,100 --ratio 3` to crop a 200-by-100-pixel region
starting at `(100, 50)` and render it at 600 by 300 pixels. Coordinates are in
the laid-out source viewport, measured from the top-left. Selection applies to
PNG and kitty output in both commands; other formats report an error. Fractional
coordinates and regions extending outside the image are supported.

An explicit format takes precedence over the output filename. Otherwise the
output extension selects the format; stdout defaults to kitty, including when
redirected or piped. Use `-f svg` for SVG on stdout, `-f pdf` for binary PDF on
stdout, or `-o figure.svg` / `-o figure.png` /
`-o figure.pdf` to select a file format automatically.
Kitty output displays inline in terminals that support the kitty graphics
protocol and ends with a newline. An explicit `-f kitty` or an output filename
ending in `.kitty` writes the same graphics sequence.

Rendering defaults to dark for kitty and light for SVG, PNG, PDF, tree, and JSON.
An explicit root `<Svg theme="light|dark">` overrides that default, and
`--theme light|dark` overrides the source root theme. Nested themes and explicit
colors in JSX still apply. Themes do not specify backgrounds. `--background`
paints a backdrop at render time; omit it for transparency. Explicit backgrounds
in JSX still apply and paint over the render backdrop. See
[Themes](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/gallery/text/Themes.md) for palettes and semantic paints.

PNG and kitty use node-canvas through `@gum-jsx/png`, loaded only for these
formats. Ordinary text is already SVG glyph paths and needs no font registration.
Emoji remain live SVG text and
depend on the rasterizer's available fonts.

PDF uses `@gum-jsx/pdf`, loaded only for this format. It writes a single vector
page sized to the viewport at 96 pixels per inch (0.75 PDF points per pixel).
`--ratio` and `--id-prefix` do not affect PDF output. Text and math remain
outlines, so they are not searchable or selectable; debug overlays are omitted.
`--title` sets PDF document metadata. Named, hex, RGB, and HSL colors are supported;
unsupported paint expressions fail with an error. See the
[PDF API documentation](https://github.com/CompendiumLabs/gum-jsx-pdf/blob/master/README.md) for format limits.

`--precision` sets the decimal places used in SVG, PDF, and tree numeric output;
PNG and kitty use the resulting SVG. Choose an integer from 0 to 100, or `full`
for unrounded JavaScript number strings. It does not change layout geometry.

Errors go to stderr and exit with status 1. For machine-readable
`--stats`, run the executable directly or use `bun run --silent gum` to suppress
Bun's script announcement.

Run `bun run typecheck` here to check the CLI, or from the workspace root to
check all packages. Run `bun run test` here for command integration tests, also included in the
workspace test command.

## Development and visual reports

From the workspace root, `bun run visual-test` evaluates every element and topic
example in `gum-jsx-docs` plus its focused visual regression cases. It checks for
evaluation/layout failures, empty viewports, non-finite SVG geometry, and empty
drawings, then writes a searchable, self-contained report to
`gum-jsx-cli/visual-report/dist/index.html`. The report includes each SVG, its
source, dimensions, timing, status filters, deep links, and light/dark page chrome.

`bun run visual-report` is an alias. The HTML opens directly from disk; for an HTTP
preview, run `bun --filter @gum-jsx/cli visual-report:serve`. Pass
`--output /some/directory` after the package script to change the generated output
directory. The checked-in report notes are in
[visual-report/README.md](./visual-report/README.md).

The protocol encoders in [src/kitty.ts](./src/kitty.ts) accept PNG or raw RGBA
data, with image/placement IDs, terminal columns/rows, cursor movement, and
virtual-placement controls. `@gum-jsx/mark` adds virtual image placements and
Unicode placeholder grids for pager output.

Watch mode and deck workflows remain
tracked in [FEATURES.md](https://github.com/CompendiumLabs/gum-jsx/blob/master/docs/FEATURES.md#command-line-and-authoring-workflows).

## Markdown terminal output

```sh
bun run gum-mark README.md
bun run gum-mark notes.md -t light -H 120
bun run gum-mark notes.md -p
printf 'Inline math: $x^2$\n' | bun run gum-mark
```

`gum-mark` renders headings and inline Markdown as ANSI text. Fenced `gum` or
`gum.jsx` blocks, local `.jsx`, `.svg`, and `.png` images, and `$...$` or
`$$...$$` math become kitty graphics. Fence metadata and image alt text accept
`width=`, `height=`, and `theme=` overrides. `--pager` sends virtual image
placements to the terminal and passes their Unicode placeholder grids through
`less -R`.

## Standalone TeX

```sh
bun run gum-tex 'e^{i\pi}+1=0' -o /tmp/euler.svg
bun run gum-tex 'e^{i\pi}+1=0' -o /tmp/euler.pdf
bun run gum-tex '\frac{a+b}{c+d}' -s 48 -p 0.25 -o /tmp/fraction.png --ratio 2
bun run gum-tex -i formula.tex --inline -f tree --stats
printf '%s\n' '\int_0^1 x^2\,dx=\frac13' | bun run gum-tex -f svg
bun run gum-tex 'x^2' --fit -W 320
bun run gum-tex 'x^2' --theme dark
bun run gum-tex 'x^2' -t light --background white -o /tmp/formula.png
bun run gum-tex --help
```

The `gum-tex` positional argument is literal TeX. Omit it or use `-` for stdin; use `-i` / `--input` for a file.
Literal input and `--input` are mutually exclusive. Supply formula contents
without `$` or `$$` delimiters. Quote shell input with single quotes to preserve
backslashes; use `--` before a formula starting with a dash.

The shared output options above apply to both commands; `--natural` is JSX-only. TeX adds:

| Option | Meaning |
|---|---|
| `-s, --font-size <pixels>` | Positive base em, default `64`. |
| `-p, --padding <em>` | Nonnegative padding on each side, default `0`. |
| `--inline` | Text style; the default is display style. |
| `--no-strut` | Omit the minimum formula line box. |
| `--color <color>` | Formula color, default theme foreground (white for dark, black for light). |
| `--macro <command=tex>` | Repeatable definition, such as `'\RR=\mathbb{R}'`. |
| `--fit` | Allow enlargement into `-W` and/or `-H`; the default only shrinks. |
| `--no-fit` | Keep the original formula size and clip to the viewport. |

Natural exports use `mathToElement` from `@gum-jsx/math`: logical space and all
visible ink are included, with negative extents translated into the viewport.
Empty axes have a one-pixel floor. This preserves italic overhang, accents,
laps, and smashed ink without changing their typographic advance inside other
layouts. `gum` and `gum-tex` share layout, inspection, SVG, PNG, PDF, and kitty output.

Font size controls typography. `-W` / `-H` shrink the formula when necessary;
`--fit` also allows enlargement and requires at least one dimension. `--no-fit`
keeps the formula unscaled and clips it to the viewport.
`--ratio` controls raster resolution independently. Errors retain the formula's
layout path and TeX source range when available; malformed and unsupported TeX
exit with status 1. No JavaScript evaluation is used for TeX input.

See the [standalone export guide](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/gallery/text/MathExport.md) for
synchronous/asynchronous library helpers and font-resource ownership.
