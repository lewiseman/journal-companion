# J01 companion contract

`suggest-diary-day` is an additive v1 signed job operation on the existing text
assignment. Authenticated status advertises `diaryContract:1` and `diaryLimits`.
Input is JSON `{entries:[{id:"e0",text:"..."}]}`: 1–12 sequential temporary IDs
within a 2,000-byte complete envelope. Dates, journal identifiers and existing
metadata are not accepted fields. Oversized days are refused, never truncated.

QVAC SDK 0.22.0's per-request `responseFormat:json_schema` requires exactly
`title` (≤80 chars), `mood` `{value, evidence}` where value is one of
`happy|calm|excited|tired|low|mixed|unclear`, and `themes` (≤3 `{label, evidence}`),
with `additionalProperties:false` throughout. Requests are deterministic
(`temp:0`, seed 42), `kvCache:false`, bounded to 320 tokens/2,048 bytes and 90 s.
Token exhaustion returns `OUTPUT_LIMIT` with no partial result.

The companion checks only the envelope. Flutter holds the source text and is the
authoritative check: evidence must quote the entries, titles must share wording,
and diagnosis/sensitive labels are dropped. Desktop never stores the result beyond
the existing encrypted job retention, cancellation fences and acknowledgment.
Activity shows **Suggest diary details** with the device and model.

Run `npm test`, `npm run package`, then
`node scripts/verify-notes.cjs /absolute/new/empty/evidence /absolute/model.gguf --diary`.
The shared harness sends synthetic sparse, mixed and ordinary days, restarts the
packaged app, retrieves and acknowledges each result and removes test trust.
Reports are `diary-native-1.json` and `diary-native-2.json`.

See the Flutter repository's `docs/diary-suggestions.md` for UI, grounding,
storage, sync, roles and verification status.

## J02 daily questions

`ask-diary-question` (`questionContract: 1`, limits in `questionLimits`) accepts
`{"today":[{id:"t0",text}],"prior":[{id:"p0",ago:1..7,text}],"avoid":[...]}`
(at most 4 / 8 / 5, 2,000 bytes) and returns
`{"question","source":""|"tN"|"pN","evidence"}` under a JSON-schema grammar with
160 output tokens. Unlike the other bounded operations it samples at temperature
0.7 with a random seed, so a repeated request yields a fresh question. Grounding,
timing, repetition and sensitivity are checked on the phone; see
`journal/docs/daily-questions.md`. Verify with
`node scripts/verify-notes.cjs <new dir> <model.gguf> --question [--model-id=…]`.

## S01 historical answers

`answer-diary-question` (`historyContract: 1`, limits in `historyLimits`)
accepts `{"question","today","scope":{from,to}|null,"sources":[{id:"s0",date,text}]}`
with 1–8 dated excerpts in date order (≤ 400 characters each, 2,000 bytes total)
and returns `{"answer","citations":["sN"],"status":"answered"|"insufficient"}`
at temperature 0 under a grammar that writes the answer and citations before the
status. The phone selects excerpts, validates citations and source versions; see
`journal/docs/diary-history.md`. Verify with
`node scripts/verify-notes.cjs <new dir> <model.gguf> --history [--model-id=…]`.
