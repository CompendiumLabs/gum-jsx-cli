import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { png_size } from '@gum-jsx/core'
import Papa from 'papaparse'
import type { ParseConfig } from 'papaparse'

type CsvOptions = Pick<ParseConfig, 'delimiter' | 'dynamicTyping'>

// Bind paths to the source, including functions later called from a slide or frame.
function file_loaders(name?: string) {
  const directory = name === undefined ? process.cwd() : dirname(resolve(name))

  // Keep file and parser failures together, with the resolved path in every error.
  function load_file<T>(path: string, parse: (data: Buffer) => T): T {
    if (typeof path !== 'string' || !path) throw new TypeError('File path must be a non-empty string')
    const file = resolve(directory, path)
    try {
      return parse(readFileSync(file))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new Error(`Cannot load ${JSON.stringify(file)}: ${message}`, { cause })
    }
  }

  // JSON may contain any value, not just a table or configuration object.
  function load_json(path: string): unknown {
    return load_file(path, data => JSON.parse(data.toString('utf8')))
  }

  // Parse strings synchronously; only expose options that retain the row-object API.
  function load_csv(path: string, { delimiter = ',', dynamicTyping = true }: CsvOptions = {}) {
    return load_file(path, data => {
      const result = Papa.parse<Record<string, unknown>>(data.toString('utf8'), {
        header: true, skipEmptyLines: true, delimiter, dynamicTyping,
      })
      const error = result.errors[0]
      if (error) throw new Error(`Invalid CSV (${error.code}): ${error.message}`)
      return result.data
    })
  }

  // Preserve the original PNG bytes; the renderer decodes pixels when needed.
  function load_png(path: string): string {
    return load_file(path, data => {
      const image = `data:image/png;base64,${data.toString('base64')}`
      png_size(image)
      return image
    })
  }

  return { loadJSON: load_json, loadCSV: load_csv, loadPNG: load_png }
}

export { file_loaders }
export type { CsvOptions }
