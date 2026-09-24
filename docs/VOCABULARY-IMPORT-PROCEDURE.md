# Vocabulary asset import procedure

This procedure applies before any production vocabulary asset is added. The current production manifest is intentionally empty; an allowlisted source name is not approval to import a dataset.

1. Use only OpenAlex, TheSoz, or STW. Do not import APA, a restricted source, or any source whose package, release, mapping, or commercial-reuse terms are unclear.
2. Save reviewed official package/release evidence under `web/src/lib/vocabulary/evidence/`. Record the official source URI, exact release identifier, source-specific license name and URL, required attribution text, and whether Peer modified the asset.
3. Store only the reviewed local asset beneath `web/src/lib/vocabulary/` and calculate its SHA-256. The manifest may use only a relative asset path; absolute paths, traversal, missing files, and checksum mismatches are rejected.
4. Add a complete manifest record: source URI, release ID, license identity, attribution, modification flag and description, asset path, SHA-256, format, `peer-vocabulary-record-v1` schema, import timestamp, and mapping provenance. Every derived mapping must identify its relation (`exact`, `close`, or `related`), target source/id, and evidence; mappings are not automatic synonyms. Every derived mapping must also identify the exact release of the target source it was verified against, so a later republish of that target cannot silently invalidate the mapping.
5. Have a second reviewer verify the release evidence, checked-in asset, checksum, license/attribution duties, modifications, and mappings. Only then may the verifier-approved record appear on `/data-sources` and be added to third-party notices as appropriate.

Never copy third-party vocabulary text into tests or this procedure. Test fixtures must be tiny, invented, and clearly test-only.
