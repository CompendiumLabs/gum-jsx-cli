# gum-next-cli

The Bun command-line interface for `gum-next-core`. It reads gum JSX, lays out the
result, and writes SVG, PNG, a fragment tree, or JSON. Argument parsing, file and
terminal I/O, and PNG conversion live here; evaluation, layout, SVG serialization,
and fragment inspection use the core's public API.

From the workspace root:

```sh
bun install
bun run gum --help
bun run gum gum-next-core/examples/hugging.jsx -f tree --stats
bun run gum gum-next-core/examples/repeated.jsx -o /tmp/repeated.svg
bun run gum gum-next-core/examples/card.jsx --width 220 -o /tmp/card.png --ratio 2
printf '%s\n' '<Square width={px(40)} fill="tomato"/>' | bun run gum -f svg
```

The package also exposes a `gum` executable at `node_modules/.bin/gum` in the
workspace. Inside this package, use `bun run gum [file.jsx] [options]`. Input and
output paths are relative to the directory where you run the command.

```text
Usage: gum [file.jsx|-] [options]

  -f, --format svg|png|tree|json   Output format (default: svg or output extension)
  -o, --output file              Write output to a file instead of stdout
      --width pixels            Set the viewport width
      --height pixels           Set the viewport height
      --ratio number            PNG sampling ratio (default: 1; uses rsvg-convert)
      --background color        Paint the viewport background
      --title text              Add an escaped SVG title
      --id-prefix name          Prefix SVG definition IDs (default: gum)
      --stats                   Print layout counters to stderr
  -h, --help                    Show this help
```

Omit the input file or use `-` to read stdin. A bare element is wrapped in `Svg`.
Width and height are independent pixel overrides; omitted axes retain source
sizing or hug the content. Zero is a valid viewport dimension. The PNG ratio must
be positive and changes raster sampling without changing layout.

An explicit format takes precedence over the output filename. Otherwise the
output extension selects the format; stdout defaults to SVG. PNG requires
`rsvg-convert` on `PATH`. SVG, tree, and JSON require only Bun and the workspace
dependencies. Errors go to stderr and exit with status 1. For machine-readable
`--stats`, run the executable directly or use `bun run --silent gum` to suppress
Bun's script announcement.

Run `bun run test` and `bun run typecheck` here, or run those commands from the
workspace root to check all packages. The CLI tests exercise the real command
with files, stdin, options, output formats, resizing, and diagnostics; PNG checks
run when `rsvg-convert` is installed.

PDF, kitty terminal graphics, watch mode, themes, TeX, and deck workflows remain
tracked in [FEATURES.md](../docs/FEATURES.md#command-line-and-authoring-workflows).
