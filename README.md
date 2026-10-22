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
- **Depth control.** A row of buttons beneath the title opens the whole document to a depth, a cheap form of semantic zooming (Engelbart's level clipping). Depth 0 shows the short forms; depth N opens every Elaborate from level 1 down to N. Levels start again at 1 inside content opened beneath a phrase. Choosing a depth resets whatever the reader opened or closed by hand.
- **Keyboard and screen reader support.** Every control is focusable, focus follows what opens and closes, and controls name what they reveal.

It currently shows a hand-written sample, [`examples/sample.json`](examples/sample.json).

## Where the documents will come from

The plan is to build elastic documents from an Obsidian vault. Every shorter level is a generated artefact that records the passages it came from, so *compress, do not invent* becomes the direction the build runs and stable expansions become a cache. Vault text counts as approved by its owner; only the build's output is marked as generated. See [ADR 0001](docs/adr/0001-build-elastic-documents-from-the-vault.md).

## Running it

```sh
npm install
npm run dev     # the reader, at the URL Vite prints
npm test        # Vitest
npm run build   # a static build in dist/
```

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

## How the code is arranged

The logic lives in a tested core with no DOM. The browser code draws what the core says and forwards the reader's clicks and keys to it as intents.

```mermaid
flowchart LR
    J[Document JSON] --> P[parseDocument]
    P --> R[Reader core<br/>state and transitions]
    R -->|view model| B[Browser adapter<br/>draws the page]
    B -->|intents: activate, toggle, depth| R
```

- `src/core/document.ts` parses and validates documents.
- `src/core/state.ts` and `src/core/reader.ts` hold what is open and decide what each intent does, including where focus goes.
- `src/core/view.ts` turns the document and state into what the reader sees.
- `src/browser/render.ts` draws the view and handles clicks and keys.

## Next ideas

- **Provenance marking**: style the author's words, AI compressions and AI additions differently.
- **View filters**: "show only the assumptions" or "show only what the author said".
- **Fisheye prerequisites**: opening a claim also brings in the claims it depends on.
- **Orientation**: an outline, and the open state in the URL.
- **Study conditions**: six operations against one, provenance shown or hidden, and a downloadable event log.
- **Single-file export** of a document and its reader.
- **A first real document** built from a vault note, with an error planted in generated text.

## Licence

[MIT](LICENSE)
