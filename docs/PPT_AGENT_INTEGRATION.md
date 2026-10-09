# PPT Agent integration

FilingLens applies the deterministic planning and presentation-quality ideas from
[`tobias-bettinger/ppt-agent`](https://github.com/tobias-bettinger/ppt-agent), reviewed at commit
`24a8b9c072665c93f4a3a40edf35b0c6127bf362`.

The upstream workflow starts with open-ended research and uses separate model calls for research,
outline, content, design and visual review. FilingLens already produces a validated `FilingAnalysis`
contract, so the presentation workflow begins from that contract. This prevents the presentation
stage from changing financial facts or introducing uncited claims.

The integration adds:

- a typed Pydantic presentation plan with sequential, unique slide contracts;
- deterministic action titles derived from validated summaries and financial series;
- explicit narrative purpose, source note and speaker notes for every slide;
- native PowerPoint charts and FilingLens' bilingual institutional layouts;
- strict chart length and finite-number validation;
- a post-build quality report that checks package integrity, slide count, action titles, source
  disclosure and data-quality disclosure;
- response headers identifying the planner/renderer and quality score.

No upstream source code is copied. The upstream README labels the project MIT, but the reviewed
commit does not contain a license file. The architectural ideas were therefore reimplemented for
FilingLens rather than vendored. The upstream visual-QA loop also records suggested fixes without
applying them; FilingLens uses enforceable deterministic checks in production instead of claiming
an iterative visual correction that does not occur.

The Railway deployment remains two services: the Node application proxies `/api/presentation` to
the private `filinglens-data-tools` Python service. The generated deck remains fully editable and is
round-tripped through `python-pptx` before download.
