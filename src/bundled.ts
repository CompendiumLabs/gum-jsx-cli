#!/usr/bin/env node

import * as core from '@gum-jsx/core'
import * as math from '@gum-jsx/math'
import * as maps from '@gum-jsx/maps'
import * as png from '@gum-jsx/png'
import * as pdf from '@gum-jsx/pdf'
import * as mp4 from '@gum-jsx/mp4'

// Plugins must share the CLI's Element/Projection classes. Loading another
// installed copy would break instanceof checks when composing their elements.
const libraries: Record<string, Record<string, unknown>> = {
  '@gum-jsx/core': core,
  '@gum-jsx/math': math,
  '@gum-jsx/maps': maps,
  '@gum-jsx/png': png,
  '@gum-jsx/pdf': pdf,
  '@gum-jsx/mp4': mp4,
}
if (typeof Bun !== 'undefined') {
  Bun.plugin({
    name: 'gum-plugin-libraries',
    setup(build) {
      for (const [name, exports] of Object.entries(libraries)) {
        build.module(name, () => ({ loader: 'object', exports }))
      }
    },
  })
}

await import('./cli')
