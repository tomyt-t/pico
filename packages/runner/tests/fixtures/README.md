# Historical execution v1

`legacy-v1.json` is the unmodified operational envelope extracted from the
pre-refactor scientific archive in `packages/lab/tests/fixtures/legacy-v1`.
The historical implementation, not this package, executed Python and wrote it.
`legacy-provenance.json` preserves the writer hashes and expected snapshot hash.
The original generator and full provenance remain with the lab fixture.
No external model or service was called. Tests must never rewrite these fixtures.
