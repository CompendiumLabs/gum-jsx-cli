#!/usr/bin/env bun

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { evaluate, LayoutPass, render_svg, Svg } from 'gum-next-core'
import * as math from 'gum-next-math'
import { createMathFonts } from 'gum-next-math'
import {
  elementsCodeDir,
  packageRoot as docsRoot,
  topicsCodeDir,
  visualTestsCodeDir,
} from '../../gum-next-docs/src/dirs'

type Status = 'pass' | 'fail'

type Entry = {
  id: string
  name: string
  group: string
  path: string
  code: string
  status: Status
  svg: string | null
  error: string | null
  width: number | null
  height: number | null
  duration: number
}

type Manifest = {
  generated: string
  groups: string[]
  passed: number
  failed: number
  duration: number
  examples: Entry[]
}

const groups = [
  { name: 'elements', dir: elementsCodeDir },
  { name: 'topics', dir: topicsCodeDir },
  { name: 'visual', dir: visualTestsCodeDir },
] as const

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}

const workspaceRoot = dirname(docsRoot)
const fonts = createMathFonts()
const pass = new LayoutPass({ fonts: { value: fonts, version: fonts.version } })

function renderExample(group: string, path: string): Entry {
  const started = performance.now()
  const code = readFileSync(path, 'utf8')
  const name = basename(path, '.jsx')
  const base = {
    id: `${group}/${name}`,
    name,
    group,
    path: relative(workspaceRoot, path),
    code,
  }
  try {
    if (!code.startsWith('// ')) throw new Error('Visual examples must start with a descriptive comment')
    const element = evaluate(code, { name: path, scope: math, seed: 1 })
    if (!(element instanceof Svg)) throw new TypeError('Visual examples must include an Svg viewport')
    const fragment = pass.layout(element)
    if (!(fragment.size.width > 0 && fragment.size.height > 0)) {
      throw new Error(`Empty viewport: ${fragment.size.width} × ${fragment.size.height}`)
    }
    const svg = render_svg(fragment, {
      title: `${group}/${name}`,
      id_prefix: `visual_${group}_${name}`.replace(/[^A-Za-z0-9_.-]/g, '_'),
    })
    if (/NaN|Infinity/.test(svg)) throw new Error('Rendered SVG contains non-finite geometry')
    if (!/<(?:path|rect|ellipse)\b/.test(svg)) throw new Error('Rendered SVG contains no drawing')
    const entry: Entry = {
      ...base,
      status: 'pass',
      svg,
      error: null,
      width: fragment.size.width,
      height: fragment.size.height,
      duration: performance.now() - started,
    }
    console.log(`PASS ${entry.path} (${entry.width} × ${entry.height})`)
    return entry
  } catch (error) {
    const entry: Entry = {
      ...base,
      status: 'fail',
      svg: null,
      error: errorMessage(error),
      width: null,
      height: null,
      duration: performance.now() - started,
    }
    console.error(`FAIL ${entry.path}: ${entry.error?.split('\n')[0]}`)
    return entry
  }
}

function outputArgument(): string {
  const index = process.argv.indexOf('--output')
  if (index < 0) return new URL('../visual-report/dist/', import.meta.url).pathname
  const value = process.argv[index + 1]
  if (!value) throw new Error('--output requires a directory')
  return resolve(value)
}

const started = performance.now()
const examples = groups.flatMap(({ name, dir }) => readdirSync(dir)
  .filter(file => file.endsWith('.jsx'))
  .sort(naturalCompare)
  .map(file => renderExample(name, join(dir, file))))
const passed = examples.filter(entry => entry.status === 'pass').length
const failed = examples.length - passed
const manifest: Manifest = {
  generated: new Date().toISOString(),
  groups: groups.map(group => group.name),
  passed,
  failed,
  duration: performance.now() - started,
  examples,
}

const output = outputArgument()
const template = readFileSync(new URL('../visual-report/template.html', import.meta.url), 'utf8')
const json = JSON.stringify(manifest).replace(/</g, '\\u003c')
const html = template.replace('<!--REPORT_DATA-->',
  `<script id="report-data" type="application/json">${json}</script>`)
if (html === template) throw new Error('Report template is missing its data marker')
mkdirSync(output, { recursive: true })
writeFileSync(join(output, 'index.html'), html)
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))

console.error(`\n${passed} passed, ${failed} failed`)
console.error(`report: ${join(output, 'index.html')}`)
if (failed > 0) process.exitCode = 1
