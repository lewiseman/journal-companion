# N01 companion writing operations

The existing Electron/QVAC text assignment supports `rewrite-note`, `expand-note`, `tone-note`, `clarify-note` and `markdown-note`. These are separate explicit operations. Flutter owns review, acceptance and local recovery. See [the authoritative Flutter behavior, data lifetime and evidence](../../journal/docs/note-writing.md) and [sanitized verification](../../journal/docs/note-writing-evidence.json).

`src/transform.cjs` validates a strict JSON `{text, intent}` inside the existing signed `prompt`. The complete prompt is at most 2,000 UTF-8 bytes; intent is at most 240 bytes and required for tone. Output is bounded to 4,096 bytes/768 tokens. Empty/broken Unicode, control characters, HTML and unexpected JSON envelopes fail closed. No source/output is included in Activity. Facts, uncertainty, language and voice are preserved by instruction and human review; model output cannot write application data directly.

Runtime generation reuses the installed SDK 0.22.0 completion API, separate system/user messages, disabled KV caching, deterministic parameters, timeout and cancellation. Token-budget exhaustion returns `OUTPUT_LIMIT`, never partial text. Model and dependency versions did not change. The installed SDK's `dist/examples/completion-stop-reason.js` is the version-specific API reference used here.

Capability status advertises operations plus `transformLimits`. Existing encrypted durable acceptance, signed pinned-TLS access, same-ID deduplication, expiry, result acknowledgment, restart classification and device ownership remain in force. Signed cancellation optionally supplies `{operation}` when fencing an unknown ID; legacy summary callers keep their existing default. Desktop Activity shows a friendly operation name, device, model and state.

## Reproduce real native verification

```sh
npm test
npm run package
node scripts/verify-notes.cjs /absolute/new/empty/n01-evidence /absolute/verified/model.gguf
```

Use Node 24.9+ and the existing provisioned model on macOS arm64. The harness refuses an existing nonempty directory. It launches the actual packaged app twice with synthetic signed TLS client requests. Phase one executes every operation with real QVAC, retries identities without duplicate jobs and checks Activity attribution. Phase two retrieves the results after desktop restart, acknowledges them and revokes the synthetic device. Reports are `notes-native-1.json` and `notes-native-2.json`. No phone pairing-UI coverage is claimed by that synthetic client.

The physical Samsung Android demonstration used the existing isolated R01 CLI enrollment fixture and production pinning/signing/inference. Flutter's integration test performed editor/form → review → accept → recovery, rejection, a discarded real acceptance response retrieved with the same ID, and refusals after source and role changes. See the linked instructions for reproducing it with separate storage/trust and restoring the normal APK.

All 29 Node tests passed. Tests include signed writing cancellation fences, invalid output, malformed/bounded input, all operation prompts and output-token exhaustion; runtime/transport/storage failures in those tests are injected. The real small-model outputs are retained in the evidence: Markdown changed usefully, but grammar/expansion/style quality was uneven and proper-name casing could regress. Do not equate a completed task with a high-quality edit. Physical iPhone, other desktop hosts, broad language/quality and simultaneous phone/desktop offline-LAN behavior remain unverified.
