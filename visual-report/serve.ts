#!/usr/bin/env bun

import { file, serve } from 'bun'
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'

const dist = new URL('./dist/', import.meta.url).pathname
const index = join(dist, 'index.html')
if (!existsSync(index)) {
  console.error('No visual report. Run `bun run visual-report` first.')
  process.exit(1)
}

const port = Number(process.env.PORT ?? 3000)
const server = serve({
  port,
  fetch(request) {
    let path = normalize(decodeURIComponent(new URL(request.url).pathname))
    if (path.startsWith('..')) return new Response('not found', { status: 404 })
    if (path === '/' || path === '.') path = '/index.html'
    return new Response(file(join(dist, path)))
  },
})

console.log(`visual report at ${server.url}`)
