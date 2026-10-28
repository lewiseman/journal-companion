# H01 companion contract

`present-text` is an additive v1 signed job operation on the existing text
assignment. Authenticated status advertises `presentationContract:1` and
`presentationLimits`. Input is JSON `{blocks:[{id:"b0",text:"..."}],intent:"..."}`,
with 1–16 sequential temporary IDs, a 2,000-byte complete envelope and a 240-byte
intent limit. Original journal identifiers and metadata are not accepted fields.

QVAC SDK 0.22.0's per-request `responseFormat:json_schema` requires exactly HTML
and CSS string fields. Its HTML enum contains the complete fixed source-slot
template for this request; no source text is reproduced. CSS is generated under
the supported-property instructions. The SDK forwards explicit `required` and
`additionalProperties:false` constraints to llama.cpp's native GBNF conversion.
This behavior was checked in the installed SDK's
`dist/examples/llamacpp-structured-output.js` and real packaged inference.

Neither grammar nor model instructions are the rendering security boundary.
The companion checks Unicode, the exact output envelope and 4,096-byte size;
Flutter independently validates every HTML/CSS construct and source reference,
then renders native typed widgets. Desktop never renders this output. Requests
remain deterministic, bounded to 768 tokens/90 seconds, with `kvCache:false`,
existing encrypted retention, cancellation, durable receipts and acknowledgment.

The installed 0.5B model initially omitted CSS without the grammar. Structured
generation produced valid simple spacing for the synthetic examples, but broader
styling quality remains unproven. The renderer rejects incompatible CSS and
truncated results without changing source. H01 does not replace/download models.

Run `npm test`, `npm run package`, then
`node scripts/verify-notes.cjs /absolute/new/empty/evidence /absolute/model.gguf --presentation`.
The shared N01 harness selects synthetic H01 note cases with this flag and
otherwise preserves its original five-operation behavior. It restarts the
packaged app, retrieves both results, acknowledges them and removes test trust.
Reports are `presentation-native-1.json` and `presentation-native-2.json`.

See the Flutter repository's `docs/safe-presentation.md` for UI, rendering,
storage, roles, mobile demonstrations and exact supported syntax.
