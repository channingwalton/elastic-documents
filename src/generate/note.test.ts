import { describe, expect, it } from 'vitest'
import { parseNote, plainText } from './note'

const passage = (text: string) => ({ kind: 'passage', text })
const heading = (text: string) => ({ kind: 'heading', text })

describe('parseNote', () => {
  it('reads the title from the first heading and the headings and passages beneath it, after the frontmatter', () => {
    const note = parseNote(
      'Execution class',
      `---
aliases: ec
---

# Execution Classes

## Concept

AI skills should target behavioural capability.

An execution class defines the abilities a skill may assume.
`,
    )

    expect(note).toEqual({
      name: 'Execution class',
      title: 'Execution Classes',
      items: [
        heading('Concept'),
        passage('AI skills should target behavioural capability.'),
        passage('An execution class defines the abilities a skill may assume.'),
      ],
      skipped: [],
    })
  })

  it('reads frontmatter after a byte order mark, or closed with trailing spaces', () => {
    expect(parseNote('N', '\uFEFF---\ntags: x\n--- \nText.\n').items).toEqual([passage('Text.')])
  })

  it('drops Obsidian and HTML comments, keeping the line numbers of what it skips', () => {
    const note = parseNote('N', 'Text %%a private aside%% goes on.\n\n%%\nA hidden\nblock\n%%\n<!-- html -->\n```\ncode\n```\n')

    expect(note.items).toEqual([passage('Text goes on.')])
    expect(note.skipped).toEqual(['line 8: a code block'])
  })

  it('leaves out passages and headings with no text, such as an embed on its own line or an empty list item', () => {
    expect(parseNote('N', '# ![[banner.png]]\n\n![[diagram.png]]\n\n- \n## [[#]]\nText.\n')).toMatchObject({
      title: 'N',
      items: [passage('Text.')],
    })
  })

  it('reads a first line of dashes over prose as a horizontal rule, not frontmatter', () => {
    expect(parseNote('N', '---\nIntro rule\n\nmore\n---\n\nbody\n').items).toEqual([passage('Intro rule'), heading('more'), passage('body')])
  })

  it('reads frontmatter with a bare list item, and takes no title from a heading in a quote', () => {
    expect(parseNote('N', '---\ntitle: x\n-\n---\n> # Quoted\n\n# Real\nBody\n')).toMatchObject({ title: 'Real', items: [heading('Quoted'), passage('Body')] })
  })

  it('drops an empty heading', () => {
    expect(parseNote('N', '#\n\n##\npara\n#tag line\n')).toMatchObject({ title: 'N', items: [passage('para #tag line')] })
  })

  it('takes the title from the note name when the note has no top heading', () => {
    expect(parseNote('Stretchtext', 'Text that stretches.\n')).toMatchObject({ title: 'Stretchtext', items: [passage('Text that stretches.')] })
  })

  it('treats a later top heading as a heading', () => {
    expect(parseNote('N', '# Title\n\n# Part two\n').items).toEqual([heading('Part two')])
  })

  it('joins the lines of a paragraph with spaces', () => {
    expect(parseNote('N', 'One line\nand the next.\n').items).toEqual([passage('One line and the next.')])
  })

  it('makes each list item a passage, with its continuation lines, whatever its marker or nesting', () => {
    const items = parseNote(
      'N',
      `Can the model:

- decompose a goal?
- infer routine
  omitted steps?
    * and nested ones?
1. **Stable skill interface**: defines purpose.
2) Execution-class implementations.
- [ ] a task
`,
    ).items

    expect(items).toEqual([
      passage('Can the model:'),
      passage('decompose a goal?'),
      passage('infer routine omitted steps?'),
      passage('and nested ones?'),
      passage('1. Stable skill interface: defines purpose.'),
      passage('2) Execution-class implementations.'),
      passage('a task'),
    ])
  })

  it('reads blockquotes and callouts as passages, without their markers', () => {
    const items = parseNote(
      'N',
      `> [!note]
> The work of writing is
> untangling dependencies.

> [!tip] Keep it short
`,
    ).items

    expect(items).toEqual([passage('The work of writing is untangling dependencies.'), passage('Keep it short')])
  })

  it('keeps a callout’s title apart from its body, whatever the callout’s type', () => {
    expect(parseNote('N', '> [!note] Callout title\n> Body line.\n\n> [!my-type] Mine\n').items).toEqual([
      passage('Callout title'),
      passage('Body line.'),
      passage('Mine'),
    ])
  })

  it('reads a numbered line inside a paragraph as part of it, unless it starts a list at 1', () => {
    expect(parseNote('N', 'Year was\n2024. Big year.\n\nSteps:\n1. first\n2. repeat step 1\n\n2024. A big year.\n').items).toEqual([
      passage('Year was 2024. Big year.'),
      passage('Steps:'),
      passage('1. first'),
      passage('2. repeat step 1'),
      passage('2024. A big year.'),
    ])
  })

  it('reads a dashed line under a blockquote or footnote as a horizontal rule, not a heading underline', () => {
    expect(parseNote('N', '> A quote\n---\nAfter\n\n[^1]: Source\n---\n').items).toEqual([passage('A quote'), passage('After'), passage('Source')])
  })

  it('drops link reference definitions and Obsidian block ids', () => {
    expect(parseNote('N', 'See [the docs][d] and [more][]. ^para-1\n\n- item\n\n^list-id\n\n[d]: https://example.com\n[more]: <https://x.y> "Title"\n').items).toEqual([
      passage('See the docs and more.'),
      passage('item'),
    ])
  })

  it('reads a reference link by its text only when its label is defined, and drops a title on the line after a definition', () => {
    expect(parseNote('N', 'See [Label] and [b][missing] and [x].\n\n[label]: https://x.com\n"A title"\n').items).toEqual([
      passage('See Label and [b][missing] and [x].'),
    ])
  })

  it('moves an inline footnote to the end of the note, as a footnote', () => {
    expect(parseNote('N', 'Text ^[an inline note with [[A|a link]]] more.\n\nNext.\n').items).toEqual([
      passage('Text more.'),
      passage('Next.'),
      passage('an inline note with a link'),
    ])
  })

  it('skips math blocks, and keeps inline math as written', () => {
    const note = parseNote('N', '$$\nE = mc^2\n$$\n$$x = y$$\nAfter with $a*b*c$ inline.\n\n$$x$$ is small\n\nNext para\n')

    expect(note.items).toEqual([passage('After with $a*b*c$ inline.'), passage('$$x$$ is small'), passage('Next para')])
    expect(note.skipped).toEqual(['line 1: a math block', 'line 4: a math block'])
  })

  it('drops the checkbox of a task in any state, and an empty task', () => {
    expect(parseNote('N', '- [/] in progress\n- [ ]\n- [x]\n- [-] cancelled\n- [>] deferred\n- [link](x) stays\n').items).toEqual([
      passage('in progress'),
      passage('cancelled'),
      passage('deferred'),
      passage('link stays'),
    ])
  })

  it('skips code blocks and tables inside blockquotes and callouts, ending them where the quote ends', () => {
    const note = parseNote('N', '> [!example]\n> ```js\n> const x = 1\n> ```\n> After code.\n\n> |a|b|\n> |-|-|\n> |1|2|\n\n> ```\n> code\n\nOutside.\n')

    expect(note.items).toEqual([passage('After code.'), passage('Outside.')])
    expect(note.skipped).toEqual(['line 2: a code block', 'line 7: a table', 'line 11: a code block'])
  })

  it('reads list items and nested quotes inside a blockquote as passages of their own', () => {
    expect(parseNote('N', '> Quoted.\n> - a\n> - b\n>> nested\n> > deeper still\n').items).toEqual([
      passage('Quoted.'),
      passage('a'),
      passage('b'),
      passage('nested deeper still'),
    ])
  })

  it('reads a footnote as a passage, and its indented paragraphs as more', () => {
    expect(parseNote('N', 'A claim.[^1]\n\n[^1]: The source.\n\n    Its second paragraph.\n').items).toEqual([
      passage('A claim.'),
      passage('The source.'),
      passage('Its second paragraph.'),
    ])
  })

  it('ends a paragraph at a heading or a horizontal rule', () => {
    expect(parseNote('N', 'First\n## Next\nSecond\n\n---\nThird\n***\nFourth\n').items).toEqual([
      passage('First'),
      heading('Next'),
      passage('Second'),
      passage('Third'),
      passage('Fourth'),
    ])
  })

  it('reads a later top heading as the title when the first has no text', () => {
    expect(parseNote('N', '# ![[banner.png]]\n# Real Title\nText.\n')).toMatchObject({ title: 'Real Title', items: [passage('Text.')] })
  })

  it('reads a dashed line under a list item as a horizontal rule, not a heading underline', () => {
    expect(parseNote('N', '- item\n---\nText\n').items).toEqual([passage('item'), passage('Text')])
  })

  it('drops the closing hashes of a heading, but not a hash that ends a word', () => {
    expect(parseNote('N', '# T\n## Section ##\n## C#\n').items).toEqual([heading('Section'), heading('C#')])
  })

  it('reads indented headings, and headings underlined with = or -', () => {
    expect(parseNote('N', 'Title\n=====\n\n   ## Section\n\nIntro\n-----\nBody.\n')).toMatchObject({
      title: 'Title',
      items: [heading('Section'), heading('Intro'), passage('Body.')],
    })
  })

  it('starts a new passage where a blockquote interrupts a paragraph, and carries on a quote through a lazy line', () => {
    expect(parseNote('N', 'Some prose.\n> A quoted\nremark.\n').items).toEqual([passage('Some prose.'), passage('A quoted remark.')])
  })

  it('skips tables and code blocks, and says where they were', () => {
    const note = parseNote(
      'N',
      `# T

Before.
|CLASS|FORM|
|---|---|
|A|Concise|

\`\`\`yaml
name: synchronise
# not a heading
\`\`\`
After.
`,
    )

    expect(note.items).toEqual([passage('Before.'), passage('After.')])
    expect(note.skipped).toEqual(['line 4: a table', 'line 8: a code block'])
  })

  it('reads backticks with more backticks after them on the line as code, not a fence', () => {
    expect(parseNote('N', '```npm run generate``` is the command.\n\nLater prose.\n')).toMatchObject({
      items: [passage('npm run generate is the command.'), passage('Later prose.')],
      skipped: [],
    })
  })

  it('skips a table by its row of dashes, with or without pipes at the ends, and keeps other lines with pipes', () => {
    const note = parseNote('N', 'Choose a | b.\n\na | b\n--|:--\n1 | 2\n\nAfter.\n')

    expect(note.items).toEqual([passage('Choose a | b.'), passage('After.')])
    expect(note.skipped).toEqual(['line 3: a table'])
  })

  it('ends a table at a blank line or the next block, not at a row without pipes', () => {
    const note = parseNote('N', '|a|b|\n|-|-|\nrow without pipes\n## Next\n|c|d|\n|-|-|\n- item\n|e|f|\n|-|-|\n$$\nx\n$$\nafter\n')

    expect(note.items).toEqual([heading('Next'), passage('item'), passage('after')])
    expect(note.skipped).toEqual(['line 1: a table', 'line 5: a table', 'line 8: a table', 'line 10: a math block'])
  })

  it('reads fences and quotes indented four spaces as indented code, except under a list item', () => {
    const note = parseNote('N', 'Para\n\n    ```\n    code\n\nafter text\n\n    > quoted?\n    code\n\n- item\n\n    ```\n    listed code\n    ```\n\n  > quoted in the item\n')

    expect(note.items).toEqual([passage('Para'), passage('after text'), passage('item'), passage('quoted in the item')])
    expect(note.skipped).toEqual(['line 3: a code block', 'line 8: a code block', 'line 13: a code block'])
  })

  it('skips code indented four spaces past a list item’s text', () => {
    const note = parseNote('N', '- a\n\n      code under item\n\n  continued\n')

    expect(note.items).toEqual([passage('a'), passage('continued')])
    expect(note.skipped).toEqual(['line 3: a code block'])
  })

  it('skips code indented under a blank line, but not text indented under a list item', () => {
    const note = parseNote('N', 'Para\n\n    indented code\n\n\tmore code\nAfter.\n\n- item\n\n    continued\n')

    expect(note.items).toEqual([passage('Para'), passage('After.'), passage('item'), passage('continued')])
    expect(note.skipped).toEqual(['line 3: a code block'])
  })

  it('keeps a paragraph whole around a comment of several lines, even one holding a blank line', () => {
    expect(parseNote('N', 'A %%x\ny\nz%% B\n\nC %%x\n\ny%% D\n').items).toEqual([passage('A B'), passage('C D')])
  })

  it('says where a comment that is never closed hides the rest of the note', () => {
    expect(parseNote('N', 'A\n\nB <!-- x\n\nC\n')).toMatchObject({ items: [passage('A'), passage('B')], skipped: ['line 3: a comment that is never closed'] })
    expect(parseNote('N', '%% a\nb %% text %% never closed\n').skipped).toEqual(['line 2: a comment that is never closed'])
  })

  it('closes a comment at its closing marker, even past a stray backtick', () => {
    expect(parseNote('N', "%% don't use ` here %% visible `x`\n\nLater.\n").items).toEqual([passage('visible x'), passage('Later.')])
  })

  it('keeps comment markers inside code as code', () => {
    const note = parseNote('N', '```c\nprintf("%%d")\n```\nUse `%%` for comments.\n\nMore %% an aside %% prose.\n')

    expect(note.items).toEqual([passage('Use %% for comments.'), passage('More prose.')])
    expect(note.skipped).toEqual(['line 1: a code block'])
  })

  it('closes a code block only with a fence at least as long as the one that opened it', () => {
    const note = parseNote('N', '````md\n```js\ncode\n```\n````\nAfter.\n')

    expect(note.items).toEqual([passage('After.')])
    expect(note.skipped).toEqual(['line 1: a code block'])
  })
})

describe('plainText', () => {
  it('shows a wikilink as Obsidian does', () => {
    expect(plainText('For [[Artificial Intelligence|AI]] skills, see [[Logit control]] and [[Skills#Classes]].')).toBe(
      'For AI skills, see Logit control and Skills > Classes.',
    )
  })

  it('shows a link to a heading in the same note as the heading', () => {
    expect(plainText('See [[#Classes]].')).toBe('See Classes.')
  })

  it('drops embeds and keeps a Markdown link’s text, even when its address has brackets', () => {
    expect(plainText('![[diagram.png]]See [www](https://logicmag.io/x) and [A](https://en.wikipedia.org/wiki/A_(b)).')).toBe('See www and A.')
  })

  it('drops images, footnote markers and HTML tags, keeping the text inside tags', () => {
    expect(plainText('See ![diagram](x.png) the claim[^1] in <span class="x">markup</span>,<br>here.')).toBe('See the claim in markup, here.')
  })

  it('drops highlight markers, and struck-out text, which the author has withdrawn', () => {
    expect(plainText('A ==key== point, ~~once wrong,~~ now right.')).toBe('A key point, now right.')
  })

  it('drops emphasis markers but not underscores inside words', () => {
    expect(plainText('An **execution class** is _not_ a *rank* or __tier__; see snake_case_name.')).toBe(
      'An execution class is not a rank or tier; see snake_case_name.',
    )
  })

  it('keeps the text of code spans as written', () => {
    expect(plainText('Run `a **b** [[c]]` now.')).toBe('Run a **b** [[c]] now.')
  })

  it('reads code spans of several backticks, which may hold a backtick', () => {
    expect(plainText('Use ``a ` b`` or `` `c` `` here.')).toBe('Use a ` b or `c` here.')
  })

  it('keeps autolinks and bare web addresses as written', () => {
    expect(plainText('See <https://example.com/a_b_c> or <me@example.com>, or http://a.com/_x_ ok.')).toBe(
      'See https://example.com/a_b_c or me@example.com, or http://a.com/_x_ ok.',
    )
  })

  it('decodes HTML entities, but not in code, nor to half a surrogate pair', () => {
    expect(plainText('R&amp;D&nbsp;costs &lt;span&gt; &#8212; &#x2014; &unknown; &#55357; `&amp;`')).toBe('R&D costs <span> — — &unknown; &#55357; &amp;')
  })

  it('reads a link whose text is a web address, and emphasis around one', () => {
    expect(plainText('[https://a.com](https://a.com), **https://b.com** and _see https://c.com/_x__ ~~https://d.com~~ ==https://e.com==.')).toBe(
      'https://a.com, https://b.com and see https://c.com/_x_ https://e.com.',
    )
  })

  it('drops only what reads as an HTML tag', () => {
    expect(plainText('<b, c> and x<y and <span class="k" data-x=1>kept</span>')).toBe('<b, c> and x<y and kept')
  })

  it('removes the backslash from escaped characters', () => {
    expect(plainText('fewer than 20B \\< 30B \\*really\\*')).toBe('fewer than 20B < 30B *really*')
  })
})
