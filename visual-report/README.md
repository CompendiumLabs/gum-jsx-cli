# Visual test report

`bun run visual-report` at the workspace root evaluates every element and topic
example in `gum-jsx-docs`, plus the focused cases in
`gum-jsx-docs/visual-tests/code`. It writes a self-contained report to
`dist/index.html` and a machine-readable `dist/manifest.json`.

Open the HTML file directly, or run `bun --filter @gum-jsx/cli visual-report:serve`
and visit the printed URL. The generated `dist/` directory is intentionally
ignored.

See the [CLI README](../README.md#development-and-visual-reports) for report
options and development commands.
