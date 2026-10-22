import { describe, expect, it } from 'vitest'
import { parseDocument } from '../core/document'
import { buildSingleFile } from './build'

/** The page around what it inlines, which must not refer to any file. */
function skeleton(html: string): string {
  return html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/g, '$1</script>').replace(/<style>[\s\S]*?<\/style>/g, '<style></style>')
}

describe('buildSingleFile', () => {
  it('builds the reader with the document in place of the sample, as one file that loads nothing', async () => {
    const built = await buildSingleFile({
      title: 'Exported',
      blocks: [['Comments start with <!--<script> in HTML, and </script> ends a script.']],
    })
    if (!built.ok) throw new Error(built.errors.join('\n'))

    expect(built.html).toContain('Comments start with \\x3C!--\\x3Cscript> in HTML, and')
    expect(built.html).not.toContain('<!--')
    expect(built.html).not.toContain('premises to test')
    expect(built.html.split('</script>')).toHaveLength(2)
    expect(skeleton(built.html)).toMatch(/<script type="module"><\/script>\s*<style><\/style>\s*<\/head>\s*<body>\s*<main id="app"><\/main>/)
    expect(skeleton(built.html)).not.toMatch(/\s(?:src|href)=/)
  })

  it('reports what is wrong with an invalid document, and builds nothing', async () => {
    const invalid = { title: 'T', blocks: [[{ id: 'a b', short: '' }]] }
    const parsed = parseDocument(invalid)
    if (parsed.ok) throw new Error('expected the document to be invalid')

    expect(await buildSingleFile(invalid)).toEqual({ ok: false, errors: parsed.errors })
  })
})
