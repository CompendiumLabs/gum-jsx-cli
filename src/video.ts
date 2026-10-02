import { Element, make_viewport } from '@gum-jsx/core'
import { render_mp4, validate_mp4 } from '@gum-jsx/mp4'
import type { Video, FrameContext } from '@gum-jsx/mp4'
import type { RenderOptions } from './args'

function is_video(value: unknown): value is Video {
  return value !== null && typeof value === 'object' && typeof (value as Video).frame === 'function'
}

function prepare_video(value: unknown, options: RenderOptions): Video {
  const source = validate_mp4(value)
  return validate_mp4({
    ...source,
    size: [options.width ?? source.size[0], options.height ?? source.size[1]],
    background: options.background ?? source.background,
    frame(context: FrameContext) {
      const element = source.frame(context)
      if (!(element instanceof Element)) throw new TypeError('video.frame must return a Gum element')
      return make_viewport(element, { defaults: { theme: 'light' }, overrides: { theme: options.theme } })
    },
  })
}

async function export_video(video: Video, options: RenderOptions): Promise<void> {
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
    await render_mp4(video, options.output ?? stdout, { qp: options.qp, signal: controller.signal })
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
    if (!options.output) process.stdout.removeListener('error', output_error)
  }
}

export { is_video, prepare_video, export_video }
