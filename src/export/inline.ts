/** A built page: its HTML, and the text of each other file the build made, by the path the HTML gives. */
export interface BuiltPage {
  readonly html: string
  readonly files: ReadonlyMap<string, string>
}

/**
 * A script that loads a file, which holds nothing between its tags; a link;
 * or any other tag that refers to a file.
 */
const reference = /<script\b([^>]*)><\/script>|<link\b([^>]*)>|<[a-z]+\b[^>]*\s(?:src|href)\s*=\s*["']?([^"'\s>]*)[^>]*>/gi

/** An attribute's value after its name, in double quotes, single quotes or none. */
const value = `\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`

/**
 * The page with the scripts and stylesheets it loads written into it, so it
 * opens from disk without fetching them. Throws if the page loads a file it was
 * not given, names any other file in a src or href attribute, or does not load
 * a file it was given, such as a chunk its script imports or a font its
 * stylesheet uses. Files it was not given that are named in other ways, such
 * as srcset or a url() in a style, are not checked.
 */
export function inlinePage({ html, files }: BuiltPage): string {
  const unread = new Set(files.keys())
  const read = (path: string): string => {
    const text = files.get(path)
    if (text === undefined) throw new Error(`the page loads ${path}, which was not built`)
    unread.delete(path)
    return text
  }
  const page = html.replace(reference, (tag, script: string | undefined, link: string | undefined, other: string | undefined) => {
    if (script !== undefined) {
      const src = attribute(script, 'src')
      if (src === undefined) return tag
      const kept = script.replace(new RegExp(`\\s(?:src|crossorigin)\\b(?:${value})?`, 'gi'), '')
      return `<script${kept}>${escape(read(src), 'script')}</script>`
    }
    if (link !== undefined) {
      const href = attribute(link, 'href')
      if (href === undefined) return tag
      if (attribute(link, 'rel') !== 'stylesheet') throw cannotInline(href)
      return `<style>${escape(read(href), 'style')}</style>`
    }
    throw cannotInline(other ?? tag)
  })
  const [left] = unread
  if (left !== undefined) throw new Error(`the build made ${left}, which was not inlined, so the page would fetch it`)
  return page
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}${value}`, 'i').exec(attributes)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

/**
 * Breaks up whatever would end the element holding the text early: its closing
 * tag and, in a script, `<!--` and an opening tag, which change where the
 * browser looks for the closing one. A tag counts only where the browser would
 * read one, so `i<scriptCount` stays code. A script's `<` becomes `\x3C`, which
 * means the same in its strings and regular expressions.
 */
function escape(text: string, element: 'script' | 'style'): string {
  return element === 'script'
    ? text.replace(/<(!--|\/?script(?=[\s/>]))/gi, '\\x3C$1')
    : text.replace(/<\/(style)(?=[\s/>])/gi, '<\\/$1')
}

function cannotInline(reference: string): Error {
  return new Error(`the page refers to ${reference}, which cannot be inlined`)
}
