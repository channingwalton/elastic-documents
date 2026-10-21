# Build elastic documents from the Obsidian vault

An elastic document is a build. Its inputs are notes in Channing's Obsidian vault: their Markdown text, frontmatter links and wikilinks. Every shorter level, alignment and expansion is a generated artefact that records the input passages it came from, their content hashes, the model and prompt that produced it, and whether it has been checked. This turns the design principles into properties of the build. *Compress, do not invent* is the direction the build runs. Stable expansions are a cache keyed by input hashes. Staleness is invalidation along the links. The vault also already holds summaries at several levels, such as yearly down to daily journal notes and topic notes over their tasks and events. So the build mostly aligns and checks existing summaries rather than generating new ones.

## Considered Options

- **A separate folder of documents and sources.** Rejected: every document would have to be written for it, while the vault already holds the material, the links between levels and the place Channing writes.

## Consequences

- The vault is the trust boundary. Everything in it counts as approved by Channing, whoever wrote it; only the build's output is labelled as generated. Approving generated text writes it into the vault.
- Apart from approval, the build never writes into the vault. Anchors are computed from quoted text (W3C Web Annotation selectors), not block IDs written into notes.
- Generated artefacts live in a hidden folder that Obsidian does not index, and the reader is published outside the vault.
- Change detection comes from the vault's git history and content hashes. A change invalidates everything built from it.
- Many links between levels are implicit; a weekly note says "(Thursday)" rather than linking the daily note. The build infers these and marks them as inferred.
- The vault holds client material, so builds over it need a local or approved language model.
