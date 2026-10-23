import { describe, expect, it } from 'vitest'
import css from './style.css?raw'

/** The colour tokens on `:root`, in light mode and in the dark-mode media query. */
function tokens(): Record<'light' | 'dark', Map<string, string>> {
  const [light = '', dark = ''] = css.split('@media (prefers-color-scheme: dark)')
  const rootOf = (part: string) => /:root\s*{([^}]*)}/.exec(part)?.[1] ?? ''
  const colours = (block: string) => new Map([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name = '', hex = '']) => [name, hex]))
  return { light: colours(rootOf(light)), dark: colours(rootOf(dark)) }
}

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}

describe('the stylesheet', () => {
  it('draws each provenance mark inline, so no line breaks between a mark and its text', () => {
    // An inline-block glyph is an atomic inline, which a line may break after.
    const rule = /\.provenance-mark::before\s*{([^}]*)}/.exec(css)?.[1]

    expect(rule).toContain('display: inline;')
  })

  it('hides quiet buttons by clipping them, which keeps them in the tab order and the accessibility tree', () => {
    const rule = /> \.chips\.quiet[^{]*{([^}]*)}/.exec(css)?.[1]

    expect(rule).toContain('clip-path: inset(50%);')
    expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/)
  })

  for (const [mode, colours] of Object.entries(tokens())) {
    it(`gives the text of a test document's banner a contrast of at least 4.5:1, in ${mode} mode`, () => {
      const background = colours.get('warning-background')
      const low = ['text', 'warning'].flatMap((foreground) => {
        const colour = colours.get(foreground)
        if (colour === undefined || background === undefined) return [`--${foreground} on --warning-background: missing`]
        const ratio = contrast(colour, background)
        return ratio < 4.5 ? [`--${foreground} on --warning-background: ${ratio.toFixed(2)}`] : []
      })

      expect(low).toEqual([])
    })
  }

  const text = ['text', 'compression', 'addition']
  const backgrounds = ['background', 'open-1', 'open-2', 'attachment']

  for (const [mode, colours] of Object.entries(tokens())) {
    it(`gives the text of every provenance a contrast of at least 4.5:1 on every background, in ${mode} mode`, () => {
      const low = text.flatMap((foreground) =>
        backgrounds.flatMap((background) => {
          const [fg, bg] = [colours.get(foreground), colours.get(background)]
          if (fg === undefined || bg === undefined) return [`--${foreground} on --${background}: missing`]
          const ratio = contrast(fg, bg)
          return ratio < 4.5 ? [`--${foreground} on --${background}: ${ratio.toFixed(2)}`] : []
        }),
      )

      expect(low).toEqual([])
    })
  }
})
