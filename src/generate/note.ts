/** A heading, or a passage of the author's text: a paragraph or a list item, as plain text. */
export type NoteItem =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'passage'; readonly text: string }

/** An Obsidian note, read as the text a document is built from. */
export interface Note {
  /** The file name without `.md`, which wikilinks resolve. */
  readonly name: string
  readonly title: string
  readonly items: readonly NoteItem[]
  /** What the reader cannot show, by line: tables and code blocks. */
  readonly skipped: readonly string[]
}

const headingLine = /^ {0,3}(#{1,6})(?:\s+(.*))?$/
const underlineLine = /^ {0,3}(=+|-+)\s*$/
const ruleLine = /^\s*([-*_])(?:\s*\1){2,}\s*$/
/** A list item: its number and the mark after it, if it has a number, and its text after any task checkbox. */
const listItemLine = /^\s*(?:[-*+]|(\d{1,9})([.)]))\s+(?:\[[^\]]\](?=\s|$)\s*)?(.*)$/
/** A list item's marker and the spaces after it, which end where the item's text starts. */
const listMarker = /^\s*(?:[-*+]|\d{1,9}[.)])\s*/
const footnoteLine = /^\[\^[^\]]+\]:\s*(.*)$/
/** A link reference definition, `[label]: address`, which reading view hides. */
const definitionLine = /^ {0,3}\[(?!\^)([^\]]+)\]:\s*\S/
/** A definition with only an address, whose title may be on the next line. */
const bareDefinitionLine = /^ {0,3}\[(?!\^)[^\]]+\]:\s*\S+\s*$/
const definitionTitleLine = /^\s*(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/
const mathLine = /^\s*\$\$/
const quoteLine = /^\s*((?:>\s?)+)(.*)$/
const calloutLine = /^\[![^\]]+\][-+]?(.*)$/
/** A fence; one of backticks has no backticks after it, or it would be code on one line. */
const fenceLine = /^\s*(?:(`{3,})[^`]*$|(~{3,}))/
/** An Obsidian inline footnote, `^[text]`, whose text may hold links. */
const inlineFootnote = /\^\[((?:[^[\]]|\[\[[^\]]*\]\]|\[[^\]]*\])*)\]/g
/** A code span: a run of backticks, and the text up to the next run of the same length. */
const codeSpan = /(?<!`)(?<run>`+)(?!`)(?<code>.*?)(?<!`)\k<run>(?!`)/
/** Code spans, which keep comment markers as code, and the markers of Obsidian and HTML comments. */
const commentToken = new RegExp(`${codeSpan.source}|%%|<!--|-->`, 'g')
/** A YAML key, which frontmatter holds. */
const yamlKeyLine = /^[^\s:#-][^:]*:(?:\s|$)/

/** What kind of block a passage comes from, which decides what may end it. */
type ParagraphKind = 'plain' | 'list' | 'footnote'

/** The row of dashes under a table's header, such as `|---|:--:|` or `--|--`. */
const isTableDelimiter = (line: string): boolean => line.includes('|') && line.includes('-') && /^[\s|:-]+$/.test(line)

/** How far a line is indented, a tab reaching the next multiple of four. */
function indentWidth(line: string): number {
  let width = 0
  for (const char of line) {
    if (char === ' ') width++
    else if (char === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

/** A reference label as Markdown matches it: ignoring case, with runs of whitespace as one space. */
const normalLabel = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Reads a note's Markdown as headings and passages. The first top heading is
 * the title, or else the note's name. Each paragraph, list item, footnote,
 * blockquote paragraph and callout title is a passage, its lines joined with
 * spaces and its markup removed; inline footnotes follow at the end, as reading
 * view shows them. Frontmatter, comments and link definitions are dropped, and
 * so is anything left with no text; tables, code and math blocks are skipped
 * and listed.
 */
export function parseNote(name: string, markdown: string): Note {
  const lines = markdown.replace(/^﻿/, '').split(/\r?\n/)
  const references: ReadonlySet<string> = new Set(
    lines.flatMap((line) => {
      const label = definitionLine.exec(line)?.[1]
      return label === undefined ? [] : [normalLabel(label)]
    }),
  )
  const items: NoteItem[] = []
  const skipped: string[] = []
  const footnotes: string[] = []
  let title: string | undefined
  /** The lines of the passage being read, how deep in blockquotes it is, and what kind of block it is. */
  let paragraph: string[] = []
  let quoteDepth = 0
  let paragraphKind = 'plain' as ParagraphKind
  /**
   * Whether the last block was a list item or footnote, so that indented text
   * under it continues it rather than being code; and where that item's text starts.
   */
  let afterItem = false
  let itemIndent = 0
  /** What closes the comment open at the end of the last line, if one is, and the line it opened on. */
  let comment: string | undefined
  let commentFrom = 0

  const addPassage = (markdown: string): void => {
    const text = plainText(markdown, references)
    if (text !== '') items.push({ kind: 'passage', text })
  }
  const endParagraph = (): void => {
    addPassage(
      paragraph.join(' ').replace(inlineFootnote, (_, note: string) => {
        footnotes.push(note)
        return ''
      }),
    )
    paragraph = []
    quoteDepth = 0
    paragraphKind = 'plain'
  }
  const startParagraph = (text: string, depth: number, kind: ParagraphKind): void => {
    endParagraph()
    paragraph.push(text)
    quoteDepth = depth
    paragraphKind = kind
  }
  const addHeading = (top: boolean, markdown: string): void => {
    endParagraph()
    afterItem = false
    const text = plainText(markdown, references)
    if (top && !title) title = text
    else if (text !== '') items.push({ kind: 'heading', text })
  }
  const skip = (what: string, from: number, inBlock: (line: string) => boolean): number => {
    endParagraph()
    afterItem = false
    skipped.push(`line ${from + 1}: ${what}`)
    let next = from + 1
    while (next < lines.length && inBlock(lines[next] ?? '')) next++
    return next
  }

  let i = afterFrontmatter(lines)
  while (i < lines.length) {
    const raw = lines[i] ?? ''
    // Text indented four spaces past where text may start, the margin or a list item's text, is code.
    const codeIndent = (afterItem ? itemIndent : 0) + 4
    if (comment === undefined && paragraph.length === 0 && raw.trim() !== '' && indentWidth(raw) >= codeIndent) {
      const underItem: boolean = afterItem
      i = skip('a code block', i, (line) => line.trim() === '' || indentWidth(line) >= codeIndent)
      afterItem = underItem
      continue
    }
    // Outside a list item, a line indented four spaces can only carry on a paragraph.
    const indented = !afterItem && indentWidth(raw) >= 4
    if (comment === undefined && !indented) {
      // A code block or table in a blockquote is read inside its quote markers, and ends where the quote does.
      const block = unquote(raw)
      const inside = (line: string): string | undefined => {
        const quoted = unquote(line)
        return block.depth === 0 ? line : quoted.depth >= block.depth ? quoted.content : undefined
      }
      const fenceMatch = fenceLine.exec(block.content)
      const fence = fenceMatch?.[1] ?? fenceMatch?.[2]
      if (fence !== undefined) {
        const closing = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`)
        let closed = false
        i = skip('a code block', i, (line) => {
          const body = inside(line)
          if (closed || body === undefined) return false
          closed = closing.test(body)
          return true
        })
        continue
      }
      // `$$` alone opens math up to the next `$$`, and `$$x$$` alone is math on one line; `$$x$$ and text` is a paragraph.
      const math = mathLine.test(block.content) ? block.content.trim().slice(2) : undefined
      const mathClose = math?.indexOf('$$') ?? -1
      if (math !== undefined && (mathClose === -1 || math.slice(mathClose + 2).trim() === '')) {
        let closed = mathClose !== -1
        i = skip('a math block', i, (line) => {
          const body = inside(line)
          if (closed || body === undefined) return false
          closed = body.includes('$$')
          return true
        })
        continue
      }
      if (block.content.includes('|') && isTableDelimiter(inside(lines[i + 1] ?? '') ?? '')) {
        // A table runs to a blank line or the start of another block, with or without pipes in its rows.
        i = skip('a table', i, (line) => {
          const body = inside(line)
          if (body === undefined || body.trim() === '') return false
          const anotherBlock = [headingLine, fenceLine, mathLine, listItemLine, ruleLine].some((start) => start.test(body))
          return isTableDelimiter(body) || !(anotherBlock || (block.depth === 0 && quoteLine.test(body)))
        })
        continue
      }
      const { content } = block
      if (block.depth > 0 && paragraph.length === 0 && content.trim() !== '' && indentWidth(content) >= 4) {
        i = skip('a code block', i, (line) => {
          const body = inside(line)
          return body !== undefined && (indentWidth(body) >= 4 || body.trim() === '')
        })
        continue
      }
    }
    const wasInComment = comment !== undefined
    const [line, open, openedHere] = uncomment(raw, comment)
    if (openedHere) commentFrom = i
    comment = open
    i++
    // A line that only a comment fills, or that lies inside one, neither adds text nor ends a paragraph.
    if (line.trim() === '' && (raw.trim() !== '' || wasInComment)) continue
    if (indented && paragraph.length > 0) {
      paragraph.push(line)
      continue
    }

    const { depth, content } = indented ? { depth: 0, content: line } : unquote(line)
    if (depth > 0 && depth !== quoteDepth) endParagraph()

    const heading = headingLine.exec(content)
    if (heading !== null) {
      addHeading(heading[1] === '#' && depth === 0, (heading[2] ?? '').replace(/(?:^|\s+)#+\s*$/, ''))
      continue
    }
    if (paragraph.length === 0 && definitionLine.test(content)) {
      if (bareDefinitionLine.test(content) && definitionTitleLine.test(lines[i] ?? '')) i++
      afterItem = false
      continue
    }
    const calloutTitle = depth === 0 ? undefined : calloutLine.exec(content.trim())?.[1]
    if (calloutTitle !== undefined) {
      startParagraph(calloutTitle, depth, 'plain')
      endParagraph()
      afterItem = false
      continue
    }
    // An underline makes a plain paragraph in the same quote a heading; under a list item, quote or footnote it is a rule.
    const underline = underlineLine.exec(content)?.[1]
    if (underline !== undefined && paragraph.length > 0 && paragraphKind === 'plain' && depth === quoteDepth) {
      const text = paragraph.join(' ')
      paragraph = []
      addHeading(underline.startsWith('='), text)
      continue
    }
    if (content.trim() === '' || ruleLine.test(content)) {
      endParagraph()
      if (content.trim() !== '') afterItem = false
      continue
    }
    // Only a list numbered from 1 can interrupt a paragraph, so "2024. A big year." carries one on.
    // A numbered item keeps its number, which the author may refer to.
    const listMatch = listItemLine.exec(content)
    const [, number, mark, itemText = ''] = listMatch ?? []
    const interrupts = paragraph.length === 0 || paragraphKind === 'list' || number === undefined || Number(number) === 1
    if (listMatch !== null && interrupts) {
      startParagraph(number === undefined ? itemText : `${number}${mark} ${itemText}`, depth, 'list')
      afterItem = true
      itemIndent = indentWidth((listMarker.exec(content)?.[0] ?? '').replace(/\S/g, ' '))
      continue
    }
    const footnote = footnoteLine.exec(content)?.[1]
    if (footnote !== undefined) {
      startParagraph(footnote, depth, 'footnote')
      afterItem = true
      itemIndent = 4
      continue
    }
    if (paragraph.length > 0) {
      paragraph.push(content)
      continue
    }
    startParagraph(content, depth, 'plain')
    if (indentWidth(content) < itemIndent) afterItem = false
  }
  endParagraph()
  for (const note of footnotes) addPassage(note)
  if (comment !== undefined) skipped.push(`line ${commentFrom + 1}: a comment that is never closed`)

  return { name, title: title || name, items, skipped }
}

/**
 * The text of a line outside comments; what closes the comment still open at
 * its end, if one is; and whether that comment began on this line. `open`
 * closes a comment begun on an earlier line. Inside a comment only its closing
 * marker counts; outside, comment markers inside code spans are code.
 */
function uncomment(line: string, open: string | undefined): [string, string | undefined, boolean] {
  let visible = ''
  let at = 0
  let openedHere = false
  for (;;) {
    if (open !== undefined) {
      const end = line.indexOf(open, at)
      if (end === -1) return [visible, open, openedHere]
      at = end + open.length
      open = undefined
      openedHere = false
    }
    commentToken.lastIndex = at
    let token = commentToken.exec(line)
    while (token !== null && token[0] !== '%%' && token[0] !== '<!--') token = commentToken.exec(line)
    if (token === null) return [visible + line.slice(at), undefined, false]
    visible += line.slice(at, token.index)
    open = token[0] === '%%' ? '%%' : '-->'
    openedHere = true
    at = token.index + token[0].length
  }
}

/** How deep in blockquotes a line is, and its text inside their markers. */
function unquote(line: string): { readonly depth: number; readonly content: string } {
  const quote = quoteLine.exec(line)
  return quote === null ? { depth: 0, content: line } : { depth: (quote[1] ?? '').split('>').length - 1, content: quote[2] ?? '' }
}

/**
 * The index of the first line after the frontmatter, if the note has any. A
 * first line of dashes is frontmatter over YAML keys, or over nothing; over
 * prose it is a horizontal rule.
 */
function afterFrontmatter(lines: readonly string[]): number {
  if (lines[0]?.trimEnd() !== '---') return 0
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---')
  if (end === -1) return 0
  const body = lines.slice(1, end)
  return body.every((line) => line.trim() === '') || body.some((line) => yamlKeyLine.test(line)) ? end + 1 : 0
}

/**
 * Text kept as written: a code span, an escaped character, an autolink's
 * address, inline math, or a web address outside a link, which as in GitHub
 * Markdown leaves out a closing bracket and punctuation or markers at its end.
 */
const literal = new RegExp(
  `${codeSpan.source}|\\\\(?<escaped>[!-/:-@[-\`{-~])|<(?<link>[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\\s<>]*|[^\\s<>@\\\\]+@[A-Za-z0-9.-]+)>|\\$(?=\\S)[^$]*?(?<=\\S)\\$|(?<!\\]\\()https?://[^\\s<>\\]]*[^\\s<>\\]?!.,:*_~)=]`,
  'g',
)

/** HTML's named entities that notes use; numeric references are decoded too. */
const entities: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00A0'],
])

/**
 * Markdown as the reader of a note sees it: links as their text, wikilinks as
 * Obsidian shows them, reference links whose label is in `references` as their
 * text, HTML tags as the text inside them, entities decoded,
 * embeds, images, footnote markers, block ids and struck-out text dropped, no
 * emphasis or highlight markers, and runs of whitespace as one space. Code
 * spans, autolinks, web addresses, inline math and escaped characters are kept
 * as written.
 */
export function plainText(markdown: string, references: ReadonlySet<string> = new Set()): string {
  const literals: string[] = []
  const held = markdown.replace(literal, (...args: unknown[]) => {
    const { code, escaped, link } = args.at(-1) as Readonly<Partial<Record<'code' | 'escaped' | 'link', string>>>
    // A code span drops one space at each end when it has both, so `` `c` `` can hold a backtick at its edge.
    literals.push(code === undefined ? (escaped ?? link ?? String(args[0])) : /^ .* $/.test(code) && code.trim() !== '' ? code.slice(1, -1) : code)
    return `\uE000${literals.length - 1}\uE001`
  })
  return held
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias ?? target.split('#').filter(Boolean).join(' > '))
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/\[([^\]]+)\](?:\[([^\]]*)\])?(?![[(])/g, (whole, text: string, label?: string) => (references.has(normalLabel(label || text)) ? text : whole))
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '')
    .replace(/==(?=\S)(.+?)(?<=\S)==/g, '$1')
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '$1')
    .replace(/(^|\W)__(?=\S)(.+?)(?<=\S)__(?=\W|$)/g, '$1$2')
    .replace(/(^|\W)_(?=\S)(.+?)(?<=\S)_(?=\W|$)/g, '$1$2')
    .replace(/&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z]+));/g, (entity, decimal?: string, hex?: string, name?: string) => {
      const code = decimal !== undefined ? Number(decimal) : hex !== undefined ? parseInt(hex, 16) : undefined
      if (code === undefined) return entities.get(name ?? '') ?? entity
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : entity
    })
    .replace(/(?:^|\s)\^[A-Za-z0-9-]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\uE000(\d+)\uE001/g, (_, index: string) => literals[Number(index)] ?? '')
}
