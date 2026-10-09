import { Element, make_viewport } from '@gum-jsx/core'
import type { FontProvider } from '@gum-jsx/core'
import type { MathFontProvider } from '@gum-jsx/math'
import { Video, is_video, render_mp4, validate_mp4 } from '@gum-jsx/mp4'
import type { FrameContext } from '@gum-jsx/mp4'
import type { RenderOptions } from './args'

// Apply CLI viewport defaults to either stored frames or a lazy generator.
function prepare_video(value: unknown, options: RenderOptions): Video {
  const source = validate_mp4(value)
  const viewport = (element: Element) => {
    if (!(element instanceof Element)) throw new TypeError('Video.frame must return a Gum element')
    return make_viewport(element, {
      defaults: { theme: 'light', font_family: options.defaultFont }, overrides: { theme: options.theme },
    })
  }
  const props = {
    size: [options.width ?? source.size[0], options.height ?? source.size[1]],
    fps: source.fps,
    background: options.background ?? source.background,
  } as const
  return new Video(source.children
    ? { ...props, children: source.children.map(viewport) }
    : { ...props, duration: source.duration, frame: (context: FrameContext) => viewport(source.frame(context)) })
}

async function export_video(video: Video, options: RenderOptions, fonts: FontProvider,
  math_fonts?: MathFontProvider): Promise<void> {
  const controller = new AbortController()
  const cancel = () => controller.abort(new Error('Render cancelled'))
  const output_error = (error: Error) => controller.abort(error)
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  if (!options.output) process.stdout.on('error', output_error)
  // Await each callback so stdout applies backpressure without buffering the movie.
  const stdout = (bytes: Uint8Array) => new Promise<void>((resolve, reject) => {
    process.stdout.write(bytes, error => error ? reject(error) : resolve())
  })
  try {
    await render_mp4(video, options.output ?? stdout, { qp: options.qp, signal: controller.signal, fonts, math_fonts })
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
    if (!options.output) process.stdout.removeListener('error', output_error)
  }
}

export { is_video, prepare_video, export_video }
