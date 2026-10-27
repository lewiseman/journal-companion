# F01 saved-note summaries

The existing text capability now advertises the `summarize-note` operation and its 2,000-byte input / 2,048-byte output / 192-token generation limits. Signed job submission, encrypted durable acceptance, device-scoped deduplication, cancellation, retention, acknowledgment and captured model assignment reuse the existing protocol. Activity labels these jobs **Summarize note** and attributes them to the requesting phone without publishing input/output content.

`src/summary.cjs` owns the operation, text limits and factual instruction. `Jobs` includes the operation in duplicate detection and persists it. Runtime generation puts JSON-encoded note text in the user message, with a separate factual system instruction, temperature 0 and KV caching disabled. Empty/invalid output and token-budget exhaustion fail without publishing a partial summary. Generic `text` behavior remains available.

The Flutter integration lives in the independent authoritative `journal/` repository. Its `docs/note-summary.md` describes UI, single-note monitoring, protected recovery records, source-version checks, reset cleanup, add-only roles and physical-device verification. No model/runtime dependency versions changed.

## Reproduce native verification

With Node 24.9+, the pinned dependencies, provisioned weights and macOS arm64:

```sh
npm test
npm run package
node scripts/verify-connection.cjs /absolute/empty/evidence-directory /absolute/verified/model.gguf --summary --offline
```

The harness launches the actual packaged app twice with isolated data and a synthetic signed TLS client on port 47923. `--offline` denies public-IP outbound access to Electron main and its native QVAC worker, permits localhost for the HTTPS client, and explicitly probes an external literal IP to require an OS access denial. Chromium helpers install their own existing sandbox and remain subject to the app's CSP/session network restrictions. This changes only the verification subprocess policy; it does not disable the Mac's network or alter application security settings.

The real model generated: “Project meeting is on Friday. Mira will bring the draft. Budget approval remains pending.” It also completed a 2,000-byte ASCII fixture within output limits. Missing model, actual cancellation, encrypted-at-rest checks, renderer approval, Activity attribution, lost acknowledgment retry and result retrieval after desktop restart passed. Reports are emitted as `summary-native-1.json` and `summary-native-2.json`; compact sanitized evidence is checked into `docs/summary-evidence.json`. Test-only expiry advances are labelled in reports. The phone's dropped-ack test discards a real response after acceptance; it is deliberate fault injection, not a claim of a naturally observed packet loss.

The real Samsung phone also displayed a QVAC summary through the editor, preserved the saved source, resumed after explicit disconnect, recovered its protected identity after a cold app restart with no new submission, marked a changed source, and showed a missing-model error without submitting. Its synthetic database/trust/work were cleaned up. Router access was unavailable: **simultaneous phone/desktop use with WAN disconnected remains unverified**, distinct from the proven OS-blocked offline desktop run. No iPhone or additional operating-system support is claimed.

See [the existing transport/storage contract](CONNECTION.md) and [QVAC's text generation documentation](https://docs.qvac.tether.io/sdk/ai-capabilities/text-generation/). The installed SDK 0.22.0 example `completion-stop-reason.js` documents `final.stopReason: "length"`; that case is refused for summaries.
