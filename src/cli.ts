import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import { validate_inputs, output_options, run } from './args'
import { layout, render } from './render'
import { layout_deck, render_deck } from './deck'
import { create_evaluator } from './plugins'
import { is_video, prepare_video, export_video } from './video'

import type { RenderOptions } from './args'
import type { LayoutOptions } from './render'

type CliOptions = RenderOptions & { plugin: string[] }

// Create a fresh command so callers can customize it without parsing process arguments.
function create_cli(version: string): Command {
  const base = new Command()
    .name('gum')
    .version(version)
    .description('Render JSX figures or MP4 animations from files or stdin, or a deck directory as PDF or PPTX. Unsized figures receive a 640 × 480 offer; source sizes and natural content sizes are retained.')
    .allowExcessArguments(false)
    .argument('[files...]', 'JSX files or one deck directory (omit or use - for stdin)', ['-'])

  const program = output_options(base)
    .option('--plugin <module>', 'Load extra element/helper bindings from a package or file (repeatable; requires Bun)',
      (plugin: string, plugins: string[]) => [...plugins, plugin], [])
    .action(async (files: string[], values: CliOptions) => {
      const inputs = validate_inputs(files, values)
      const evaluator = await create_evaluator(values.plugin)
      if (inputs.multi) {
        const { deck, format } = inputs
        const options: LayoutOptions = { theme: values.theme, width: values.width, height: values.height,
          textMode: values.textMode ?? (format === 'pptx' ? 'mixed' : 'live') }
        const result = layout_deck(deck, evaluator, options)
        render_deck(result, values, format)
      } else {
        const { file, format } = inputs
        const defaultTheme = format == 'kitty' ? 'dark' : 'light'
        const options: LayoutOptions = { theme: values.theme, defaultTheme, width: values.width, height: values.height,
          textMode: ['pdf', 'pptx'].includes(format) ? values.textMode ?? (format === 'pptx' ? 'mixed' : 'live')
            : ['png', 'kitty'].includes(format) ? 'path' : values.textMode }
        const name = file === '-' ? 'stdin.jsx' : resolve(file)
        const source = readFileSync(file === '-' ? 0 : file, 'utf8')
        let tree = evaluator.evaluate(source, { name })
        if (format === 'mp4') return export_video(prepare_video(tree, values), values)
        if (is_video(tree)) {
          const video = prepare_video(tree, values)
          const time = values.time ?? 0
          if (time >= video.duration) throw new Error('--time must be less than the video duration')
          const frame = Math.floor(time * video.fps)
          tree = video.frame({ time: frame / video.fps, frame, fps: video.fps })
          options.width = video.size[0]
          options.height = video.size[1]
          values.background ??= video.background ?? '#ffffff'
        } else if (values.time !== undefined) {
          throw new Error('--time requires a video source')
        }
        const result = layout(tree, options)
        return render(result, format, values)
      }
    })
  return program
}

// Run user arguments with terminal output and the command's normal exit behavior.
async function run_cli(args: string[], version: string): Promise<void> {
  await run(create_cli(version), args)
}

export { create_cli, run_cli }
