// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { inlinePage } from './inline'

/** A page as Vite builds it, loading the reader's script and stylesheet from files. */
function builtPage(head = ''): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <title>Elastic Reader</title>
    <script type="module" crossorigin src="/assets/index.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index.css">${head}
  </head>
  <body>
    <main id="app"></main>
  </body>
</html>
`
}

function files(script: string, style: string): ReadonlyMap<string, string> {
  return new Map([
    ['/assets/index.js', script],
    ['/assets/index.css', style],
  ])
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('inlinePage', () => {
  it('puts the script and stylesheet the page loads into the page itself', () => {
    expect(inlinePage({ html: builtPage(), files: files('console.log(1)', 'body { color: red }') })).toBe(`<!doctype html>
<html lang="en">
  <head>
    <title>Elastic Reader</title>
    <script type="module">console.log(1)</script>
    <style>body { color: red }</style>
  </head>
  <body>
    <main id="app"></main>
  </body>
</html>
`)
  })

  it('keeps the text of each file exactly, even where it looks like a replacement pattern', () => {
    const script = 'text.replace(/x/, "$& $\' $` $1 $$")'
    const style = 'q::after { content: "$&" }'
    const page = parse(inlinePage({ html: builtPage(), files: files(script, style) }))

    expect(page.scripts[0]?.textContent).toBe(script)
    expect(page.querySelector('style')?.textContent).toBe(style)
  })

  it('escapes whatever would let a file run past the tag that holds it, keeping what the script means', () => {
    const tags = ['</script><script>alert(1)</SCRIPT >', 'Comments start with <!--<script> in HTML']
    const page = parse(
      inlinePage({
        html: builtPage(),
        files: files(`const fewer = 1<scriptCount, tags = ${JSON.stringify(tags)}`, '/* </style><style>p { color: red } */'),
      }),
    )

    const scripts = [...page.scripts].map((script) => script.textContent ?? '')
    expect(scripts).toEqual([
      'const fewer = 1<scriptCount, tags = ["\\x3C/script>\\x3Cscript>alert(1)\\x3C/SCRIPT >","Comments start with \\x3C!--\\x3Cscript> in HTML"]',
    ])
    expect(new Function(`const scriptCount = 2; ${scripts[0]}; return [fewer, tags]`)()).toEqual([true, tags])
    expect([...page.querySelectorAll('style')].map((style) => style.textContent)).toEqual([
      '/* <\\/style><style>p { color: red } */',
    ])
    expect(page.querySelector('#app')).not.toBeNull()
  })

  it('inlines a script and stylesheet however their attributes are written', () => {
    for (const [script, link, inlined] of [
      [
        '<script type=module crossorigin src=/assets/index.js>',
        "<link rel='stylesheet' crossorigin href='/assets/index.css'>",
        '<script type=module>',
      ],
      [
        '<script type="module" crossorigin = "anonymous" src = "/assets/index.js">',
        '<link rel = "stylesheet" href = /assets/index.css>',
        '<script type="module">',
      ],
    ] as const) {
      const html = builtPage()
        .replace('<script type="module" crossorigin src="/assets/index.js">', script)
        .replace('<link rel="stylesheet" crossorigin href="/assets/index.css">', link)

      expect(inlinePage({ html, files: files('console.log(1)', 'body { color: red }') })).toContain(
        `${inlined}console.log(1)</script>\n    <style>body { color: red }</style>`,
      )
    }
  })

  it('refuses a page that loads a file it was not given', () => {
    expect(() => inlinePage({ html: builtPage(), files: new Map([['/assets/index.css', '']]) })).toThrow(
      'the page loads /assets/index.js, which was not built',
    )
  })

  it('refuses a file it was given that it did not inline, which the page would fetch', () => {
    for (const path of ['/assets/chunk.js', '/assets/font.woff2']) {
      const given = new Map([...files('import("./chunk.js")', '@font-face { src: url(/assets/font.woff2) }'), [path, '']])

      expect(() => inlinePage({ html: builtPage(), files: given })).toThrow(
        `the build made ${path}, which was not inlined, so the page would fetch it`,
      )
    }
    const unrecognised = builtPage().replace('<script type="module"', '<script type="module" data-note="a>b"')

    expect(() => inlinePage({ html: unrecognised, files: files('', '') })).toThrow(
      'the build made /assets/index.js, which was not inlined, so the page would fetch it',
    )
  })

  it('refuses a page that refers to any other file, so the result never fetches one', () => {
    for (const [tag, reference] of [
      ['<link rel="modulepreload" crossorigin href="/assets/chunk.js">', '/assets/chunk.js'],
      ['<link rel="icon" href="/favicon.svg">', '/favicon.svg'],
      ['<img alt="" src="/logo.png">', '/logo.png'],
    ] as const) {
      expect(() => inlinePage({ html: builtPage(`\n    ${tag}`), files: files('', '') })).toThrow(
        `the page refers to ${reference}, which cannot be inlined`,
      )
    }
  })
})
