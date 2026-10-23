# Elastic Documents

A spike exploring **elastic documents**: text the reader stretches and shrinks in place. A summary opens into its detail, its sources, an example or its objections, then closes back again, and the reader stays oriented throughout.

This repository is an experimental reader for trying the ideas out. It is not a product, and it is not an Obsidian plugin.

## The idea

Ted Nelson described [stretchtext](https://xanadu.com/XUarchive/htn8.tif) in 1967: text that grows longer, with new details and clauses popping into place, and shrinks back on demand, while "the reader remains oriented". It never spread, because an author had to write every level of detail by hand.

A language model can now produce those levels. The open question is fidelity: can the reader always tell what the author said from what the AI added?

Stretchtext has relatives, and the spike borrows from them too:

| Idea | What the reader reveals |
|---|---|
| Stretchtext (Nelson, 1967) | More detail, in place |
| [Semantic zooming](https://www.cs.umd.edu/projects/hcil/pad%2B%2B/papers/jvlc-96-pad/zoom-6.html) (Pad++, 1996) | A different representation at each level |
| [View controls](https://doi.org/10.1145/1476589.1476645) (Engelbart, NLS, 1968) | Filtered and clipped views of one document |
| [Fisheye views](https://doi.org/10.1145/22627.22342) (Furnas, 1986) | Detail near the focus, landmarks further away |
| [Fluid documents](https://cdn.aaai.org/Symposia/Spring/2000/SS-00-04/SS00-04-028.pdf) (Xerox PARC, 2000) | Annotations that open between lines |
| [Transclusion](https://www.xanadu.com/xuvision.html) (Nelson, Xanadu) | The source passage itself |
| [Argument maps](https://doi.org/10.1145/58566.59297) (IBIS, gIBIS) | Why, objections, alternatives |

## Typed operations

One "more detail" control is not enough. A reader who does not understand a statement may need an example, not a longer statement. So a phrase can offer up to six operations, split by whether the result must come from the author or a source.

| Operation | Purpose | Must resolve to source? |
|---|---|---|
| Elaborate | Add detail | Yes |
| Ground | Reveal the sources | Yes |
| Derive | Show the intermediate steps | Yes |
| Exemplify | Make it concrete | No, marked as AI |
| Challenge | Show objections and limits | No, marked as AI |
| Reframe | Put it another way | No, marked as AI |

## Design principles under test

- **Compress, do not invent.** The detail comes from the author or the source; the AI produces the shorter levels. Compression can be checked against what it compresses. Generated detail cannot.
- **Provenance is visible at every level.** The author's words, an AI compression of them and an AI addition look different.
- **Expansions are stable.** Reopening an expansion shows the same content unless the reader asks for regeneration.
- **Measure comprehension, not satisfaction.** The test is whether a reader can explain the material back, not whether they felt they understood it.

The questions the spike should help answer:

1. Do readers given the six operations understand a document better than readers given one "more detail" control?
2. Are levels made by compressing a detailed source more faithful than levels made by expanding a terse one?
3. Does an elastic view of an agent-built change (intent, contract, change, diff) build more understanding than reading the diff alone?
4. Do readers catch an error planted in AI-generated text more often when provenance is marked?

## What the reader does so far

- **Expand and collapse in place.** Click a dotted phrase, or focus it and press Enter or Space.
- **Typed operations.** A phrase with one operation opens it straight away. A phrase with several shows a button for each, with a count of items. Elaborate replaces the phrase in place; the other operations open beneath its paragraph, each with a close control. Clicking a phrase with anything open closes it all.
- **Quiet buttons.** An elaborated phrase shows its buttons only while the pointer is over it or focus is inside it, and not in a phrase opened inside it. On a touch screen, tap its text. Pressed buttons for content open beneath stay, so the reader can see what is open. Hidden buttons stay in the tab order with their names.
- **Depth control.** A row of buttons beneath the title opens the whole document to a depth, a cheap form of semantic zooming (Engelbart's level clipping). Depth 0 shows the short forms; depth N opens every Elaborate from level 1 down to N. Levels start again at 1 inside content opened beneath a phrase. Choosing a depth resets whatever the reader opened or closed by hand. A depth is pressed only while every Elaborate is open exactly to it, counting those inside closed content, so no depth is pressed once the page has drifted.
- **Provenance marking.** Every paragraph, short form and long form is approved (written or approved by the author), an AI compression of approved text, or an AI addition. The author's words keep the body face. AI text takes a sans face and its own colour: upright for a compression, italic for an addition. A mark (✓, ≈ or ✦), which screen readers announce, names the provenance at the start of each level that differs from the text around it. Nothing marks where the text returns to the provenance around it, though the face and colour change back. A legend beside the Provenance switch explains the marks, and the switch hides them all.
- **Test documents.** A document with planted errors opens with a banner, which nothing closes, saying how many of its statements are deliberately false. Its Show which button lists each one, what is wrong with it, and what the generator wrote there.
- **Study conditions and sessions.** Parameters in the page's address set a study's conditions and log a reader's session; see [Running a study](#running-a-study).
- **Keyboard and screen reader support.** Every control is focusable, focus follows what opens and closes, and controls name what they reveal.

It currently shows a hand-written sample, [`examples/sample.json`](examples/sample.json).

## Where the documents will come from

The plan is to build elastic documents from an Obsidian vault. Every shorter level is a generated artefact that records the passages it came from, so *compress, do not invent* becomes the direction the build runs and stable expansions become a cache. Vault text counts as approved by its owner; only the build's output is marked as generated. See [ADR 0001](docs/adr/0001-build-elastic-documents-from-the-vault.md).

The first generator builds a document from one note:

```sh
npm run generate -- "path/to/Note.md"   # a document in generated/, which git ignores
npm run export -- "generated/Note.json"
```

- The note's text is the deepest level, as plain text: wikilinks show as Obsidian shows them, and emphasis markers, comments and frontmatter go. Each paragraph, list item or footnote is a passage. Headings and passages of 12 words or fewer stay as the author wrote them.
- A model writes a headline above each longer passage, and a one-sentence summary between them for passages over 40 words. Both are marked as AI compressions.
- Each generated level has a Ground: the parts of its passage it compresses, quoted by the model. The build fails, and writes nothing, unless every quote is exactly in its passage.
- The reader cannot show tables, code or math yet, so the build skips them and says where they were.
- The note parser reads Markdown line by line and gets some rare constructions wrong; [#16](https://github.com/channingwalton/elastic-documents/issues/16) moves it to a CommonMark parser.
- The model is Claude, through `claude -p` (Claude Code run headless, with no tools); `--model` picks which, and Sonnet is the default. Notes holding client material need a local model, which ADR 0001 requires and which does not exist yet.

A second model then checks what the first wrote:

```sh
npm run check -- "generated/Note.json"   # a review copy in generated/Note.review.json
```

- The checker reads each AI compression beside the author's text it compresses, lists the claims it makes, and judges each one supported, overstated (a hedge, condition or limit dropped), unsupported or contradicted.
- It sees only the author's text, with AI text left out and the gap marked, so it cannot cite AI text as evidence. Each judgement quotes its evidence exactly, at least three words at a time, and no quote may span a gap.
- A passage the checker gets wrong is asked about once more. If it gets it wrong again, the check fails and writes nothing.
- The review copy is the document with every claim not judged supported shown under Challenge on the level that makes it, as an AI addition, with what the passage says instead. The command prints a count of claims by verdict.
- Opus is the default checker; `--model` picks another. On a copy of a generated note with two planted errors, it flagged both, and a dropped "may" the generator had written.

To test the checker, or a reader, plant deliberate errors in a copy:

```sh
npm run plant -- "generated/Note.json" plants.json   # a test document in generated/Note.planted.json
npm run check -- "generated/Note.planted.json"
```

- `plants.json` lists each error as `{ "level": "p6", "text": "what the level is to say", "error": "what is wrong with it" }`.
- Each error replaces the short form of a level of AI text, which stays marked as AI text. The command refuses the author's text, since an error there would show as theirs.
- The test document records each planted level, what it said before and what is wrong, so the reader opens it with its banner, and so does its review copy.
- Checking a test document also prints how many of its planted errors were flagged, naming any missed. A planted error counts as flagged when any claim of its level is. One on a level the checker skips, such as an AI addition, is listed as not checked rather than missed.

## Running it

```sh
npm install
npm run dev     # the reader, at the URL Vite prints
npm test        # Vitest
npm run build   # a static build in dist/
npm run export -- examples/sample.json   # one HTML file in exports/
```

The export writes a document and the reader into a single HTML file that opens from disk, offline, with nothing to fetch, so a study reader needs only the file. It checks the document first and reports every error with its path. Give a second path to write somewhere else: `npm run export -- doc.json out.html`. The dev server and `npm run build` show [`examples/sample.json`](examples/sample.json), which `package.json` maps to `#document`.

## Running a study

One build, or one exported file, runs every condition of a study. Parameters in its address choose them:

| Parameter | Values | Effect |
|---|---|---|
| `operations` | `all` (default), `elaborate` | `elaborate` leaves Elaborate as the only control, a single "more detail" control for study question 1. A phrase with nothing else to open stays marked, but is not a control. |
| `provenance` | `switchable` (default), `shown`, `hidden` | `shown` and `hidden` fix the marking for study question 4, and remove the Provenance switch so a reader cannot change their condition. The legend stays while the marks show. |
| `session` | letters, digits, `-` and `_` | Starts a study session for the named reader. |

For example, `study.html?session=reader-B&operations=elaborate&provenance=hidden`. Any other parameter or value, or one given twice, shows "This link has errors" instead of the document, so a typo cannot put a reader in the wrong condition.

In a session:

- The page logs each thing the reader does that it acts on, with the time and the operations it opened or closed. Those include changes inside content the reader cannot see, such as an Elaborate inside a closed Challenge; replaying the logged intents from the start gives exactly what was on the page.
- A Download log button saves the log as JSON, named for the reader and when the session started, with the reader, the conditions and the document's title. The log lives only in the page until it is saved, so a reload or a closed tab loses it.
- A test document's banner reads "Study document. Some AI text in it is wrong on purpose; you'll be shown which at the end.", with no count and no Show which. Opening the same file without `session` is the debrief: the full banner, with Show which.

## Document format

A document is JSON. In a block, a string is text and an object is a stretch: a phrase with a short form and the content each operation reveals.

```json
{
  "title": "Elastic Documents",
  "blocks": [
    [
      "The idea is ",
      {
        "id": "nelson",
        "short": "Ted Nelson's stretchtext",
        "elaborate": ["Ted Nelson's stretchtext, from his Hypertext Note 8 of 1967"],
        "ground": [{ "note": "Stretchtext", "date": "2026-10-19", "quote": "the reader remains oriented" }],
        "challenge": ["It never spread: an author had to write every level by hand."]
      },
      "."
    ]
  ]
}
```

- `elaborate` holds text and stretches, so stretches nest.
- `ground` holds quoted passages, each with a `note`, a `quote` and an optional `date`.
- `derive`, `exemplify`, `challenge` and `reframe` hold paragraphs. A string stands for a paragraph of plain text; an array holds text and stretches.
- Every stretch needs a unique `id` without spaces, a non-blank `short` and at least one operation. The parser reports every error with its path.

### Provenance

A paragraph, short form or long form can be marked with where it came from: `approved`, `compression` or `addition`. A marked paragraph or long form is written `{ "provenance": ..., "inlines": [...] }`, and a marked short form `{ "provenance": ..., "text": "..." }`.

```json
{
  "provenance": "compression",
  "inlines": [
    "The idea is ",
    {
      "id": "nelson",
      "short": "Ted Nelson's stretchtext",
      "elaborate": {
        "provenance": "approved",
        "inlines": ["Ted Nelson's stretchtext, from his Hypertext Note 8 of 1967"]
      }
    },
    "."
  ]
}
```

- An unmarked level takes the provenance of the level around it, and the top level is approved. So this short form is a compression, like its paragraph. A long form takes the provenance of the text around its phrase, not of its short form.
- A mark the build forgets inside a compressed level leaves the text marked as AI text, not as approved. A forgotten mark on a top-level paragraph does show as approved, so the build must mark every paragraph it writes.
- Exemplify, Challenge and Reframe content is an addition, and so is every level inside an addition; any other mark there is an error. Ground quotes are always approved and take no mark.

### Test documents

A test document lists its planted errors beside its blocks:

```json
"planted": [
  {
    "level": "p6",
    "original": "Past a point, more instruction makes small models worse.",
    "error": "Contradicts the note, which says more instruction makes small models worse."
  }
]
```

- Each entry names a level whose short form holds a deliberate error, what it said before, and what is wrong. The level must be AI text, planted once, and no longer say what it said before.
- Any other field at the top of a document is an error, so a misspelt `planted` cannot leave a test document looking like any other.

## How the code is arranged

The logic lives in a tested core with no DOM. The browser code draws what the core says and forwards the reader's clicks and keys to it as intents.

```mermaid
flowchart LR
    J[Document JSON] --> P[parseDocument]
    P --> R[Reader core<br/>state and transitions]
    R -->|view model| B[Browser adapter<br/>draws the page]
    B -->|intents: activate, toggle, depth, provenance, reveal| R
```

- `src/core/document.ts` parses and validates documents, and writes them back as JSON.
- `src/core/conditions.ts` reads a study's conditions and session from the page's address.
- `src/core/state.ts` and `src/core/reader.ts` hold what is open and decide what each intent does, including where focus goes, and keep a session's log.
- `src/core/view.ts` turns the document and state into what the reader sees, including where provenance changes.
- `src/browser/render.ts` draws the view and handles clicks and keys.
- `src/export/build.ts` builds the reader with a given document in place of the sample, and `src/export/inline.ts` writes the script and stylesheet into the page. `scripts/export.ts` is the command.

The generator is arranged the same way: a tested core, with reading the note and calling the model as adapters.

```mermaid
flowchart LR
    N[Note Markdown] --> P[parseNote<br/>headings and passages]
    P --> G[generate<br/>levels, marks, quote check]
    G -->|CompressionRequest| C[Compressor port]
    C --> A[claude -p adapter]
    G --> J[Document JSON]
```

- `src/generate/note.ts` reads a note's Markdown as headings and plain-text passages.
- `src/generate/generate.ts` decides which levels each passage gets, asks the `Compressor` port for them, marks their provenance and checks their quotes.
- `src/generate/claude.ts` is the `Compressor` and the `Checker` behind `claude -p`, sharing one way of calling it. `scripts/generate.ts` is the command, which reads the note and writes the document.

The check follows the same shape:

```mermaid
flowchart LR
    D[Document JSON] --> K[checkDocument<br/>passages, retry, evidence check]
    K -->|CheckRequest| C[Checker port]
    C --> A[claude -p adapter]
    K -->|flags| R[reviewCopy]
    R --> J[Review copy JSON]
```

- `src/generate/check.ts` finds the author's text beneath each compression, asks the `Checker` port to judge the levels above it, asks again after a slip, and checks every quote.
- `src/generate/review.ts` writes the review copy, with each flag under Challenge.
- `scripts/check.ts` is the command, which reads the document and writes the review copy.
- `src/generate/plant.ts` plants errors in a document and records them, and `scripts/plant.ts` is its command.

## Next ideas

- **View filters**: "show only the assumptions" or "show only what the author said".
- **Fisheye prerequisites**: opening a claim also brings in the claims it depends on.
- **Orientation**: an outline, and the open state in the URL.
- **A planted error**: an error in the generated text of a real document, for the first study.

## Licence

[MIT](LICENSE)
