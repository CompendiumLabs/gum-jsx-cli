#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { Command, InvalidArgumentError, Option } from 'commander';
import {
  evaluate, Svg, LayoutPass, exact, make_request, render_svg, inspect_fragment,
} from 'gum-next-core';
import { format_image } from './kitty';

type CliOptions = {
  format?: string;
  output?: string;
  width?: number;
  height?: number;
  ratio: number;
  background?: string;
  title?: string;
  idPrefix: string;
  stats?: boolean;
};

const formats = ['kitty', 'svg', 'png', 'tree', 'json'];

// CLI sizes are explicit pixels; raster ratio is independent of the layout viewport.
function number_option(value: string, name: string): number {
  const number = value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new InvalidArgumentError(`${name} must be nonnegative and finite`);
  }
  return number;
}

function ratio_option(value: string): number {
  const ratio = number_option(value, 'ratio');
  if (ratio === 0) throw new InvalidArgumentError('ratio must be positive');
  return ratio;
}

// The command owns I/O; gum-next-png rasterizes the core's completed SVG.
async function render(file: string | undefined, values: CliOptions): Promise<void> {
  const { width, height, ratio } = values;
  const format = values.format ?? (values.output ? extname(values.output).slice(1) : 'kitty');
  if (!formats.includes(format)) throw new Error(`Unknown format: ${format}`);

  const code = readFileSync(!file || file === '-' ? 0 : file, 'utf8');
  let element = evaluate(code, { name: file ?? 'stdin.jsx' });
  if (!(element instanceof Svg)) element = new Svg({ children: element });
  const request = make_request({
    ...(width === undefined ? {} : { width: exact(width) }),
    ...(height === undefined ? {} : { height: exact(height) }),
  });
  const pass = new LayoutPass();
  const fragment = pass.layout(element, request);

  let output: string | Buffer;
  if (format === 'tree') output = inspect_fragment(fragment) + '\n';
  else if (format === 'json') output = JSON.stringify(fragment, null, 2) + '\n';
  else {
    output = render_svg(fragment, {
      background: values.background, title: values.title, id_prefix: values.idPrefix,
    });
    if (format === 'png' || format === 'kitty') {
      const { rasterize_svg } = await import('gum-next-png');
      const png = rasterize_svg(output, { size: fragment.size, ratio });
      output = format === 'kitty' ? format_image(png) + '\n' : png;
    } else output += '\n';
  }
  if (values.output) writeFileSync(values.output, output);
  else process.stdout.write(output);
  if (values.stats) console.error(JSON.stringify(pass.stats));
}

// Commander owns option parsing, validation errors, and generated help.
const program = new Command()
  .name('gum')
  .description('Read JSX from a file or stdin. Omitted viewport dimensions use source sizing or hug content.')
  .argument('[file]', 'JSX file (omit or use - for stdin)')
  .addOption(new Option('-f, --format <format>', 'Output format (default: kitty or output extension)')
    .choices(formats))
  .option('-o, --output <file>', 'Write output to a file instead of stdout')
  .option('-W, --width <pixels>', 'Set the viewport width', value => number_option(value, 'width'))
  .option('-H, --height <pixels>', 'Set the viewport height', value => number_option(value, 'height'))
  .option('--ratio <number>', 'PNG/kitty sampling ratio', ratio_option, 1)
  .option('--background <color>', 'Paint the viewport background')
  .option('--title <text>', 'Add an escaped SVG title')
  .option('--id-prefix <name>', 'Prefix SVG definition IDs', 'gum')
  .option('--stats', 'Print layout counters to stderr')
  .action(render);

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
