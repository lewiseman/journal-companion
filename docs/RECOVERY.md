# R01 durable recovery and Flutter history

The authoritative Flutter UI is Settings → AI task history in `journal/`. It uses local-only ObjectBox references and protected retry input on the existing F01 summary lifecycle. See the sibling `journal/docs/task-recovery.md` for navigation, reset, source checks and mobile storage details.

## Protocol and persistence

Authenticated `GET /v1/status` advertises `recovery: 1`. New Flutter submissions add a fixed absolute `expires` to the existing signed v1 request. The desktop caps it at 24 hours and rejects expired new requests. The original operation/input digest and deadline remain unchanged for duplicates. Old clients can still retrieve/cancel work, but new generation UI requires this recovery capability. No source content or credential data enters ordinary journal sync.

- Durable acceptance stores the complete validated bounded input, operation and captured model assignment before the response. Queued work continues after restart. Running generation is classified as interrupted, drops input, and requires an explicit new task; completed output remains retrievable.
- Cancel atomically commits a terminal state before stopping the worker. Cancelling an unknown ID writes a minimal device-scoped fence, so a delayed submission cannot start afterward. Completion wins if already committed; late worker callbacks cannot replace cancellation/interruption/expiry.
- Ack is repeatable and removes result text while preserving terminal state and a digest/identity receipt. A delayed duplicate after acknowledgment returns that receipt without executing. Flutter keeps an offline pending ack and reconciles it on foreground startup/reconnection.
- Access expires no later than 24 hours. GET immediately returns `expired` without text. Minute cleanup, start, shutdown and publication boundaries drop expired raw input/output. Active expiry requests worker cancellation. A closed app cannot delete on a wall-clock schedule; startup prunes before work resumes.
- Receipts remain until seven days after expiry, with no raw input/output. New clients' original request deadlines still prevent an expired request starting after receipt pruning. Legacy requests that omit `expires` retain only the bounded receipt-window deduplication guarantee. Revocation removes the device and all its work. Queue and retained-record caps remain 4 per phone, 16 active, 1,000 total.

Electron safeStorage encryption, atomic file replacement/fsync and per-device Ed25519 over pinned TLS remain the existing persistence/transport implementation. Packages remain Electron 45.0.0 and QVAC 0.22.0; no runtime library changed.

## Reproduce desktop process-death verification

Use Node 24.9+, provision the existing verified Qwen weights, and choose a new empty isolated directory each run:

```sh
npm test
npm run package
node scripts/verify-recovery.cjs /absolute/empty/r01-evidence /absolute/verified/model.gguf
```

The harness uses the packaged app, actual QVAC worker and a synthetic signed TLS client. It completes two real summaries, acknowledges one, submits real running/queued work, verifies the durable states and sends SIGKILL to its own Electron process. Phase two restarts the same vault/model, completes queued inference, checks interrupted running work, retrieves the earlier completed output, retries acknowledgment/submission, and exercises real cancellation plus a durable unknown-ID cancel fence. Expiry is deliberately advanced through the injected clock and labelled synthetic. Reports are `recovery-native-1.json` and `recovery-native-2.json`; checked-in sanitized evidence is `docs/recovery-evidence.json`.

SIGKILL is intentional: phase one should have signal `SIGKILL`, and phase two must exit 0. The initial attempt using `app.exit` did not provide a reliable hard-crash boundary because native generation can finish during its exit path. The final verifier requires the running/queued states synchronously and immediately kills the process. Its bootstrap is a synthetic test device; production pairing remains unchanged.

## Reproduce physical Flutter force-stop

Provision an isolated demo `app-data/model.json` containing only `{ "path": "/absolute/verified/model.gguf" }`, then launch:

```sh
"out/Journal Companion-darwin-arm64/Journal Companion.app/Contents/MacOS/Journal Companion" --connection-demo=/absolute/isolated/r01-phone --demo-port=47925 --recovery-phone-fixture
```

This **test-only CLI fixture** seeds a synthetic Ed25519 device in that isolated vault and writes a private `device-config.json`. It is not a production pairing-UI test. The phone uses production pin checking, signing, protected storage, ObjectBox and reconciliation after that bootstrap. `task-states.jsonl` records synthetic job status/timing, never note text/output. The config contains disposable test credentials: never commit it or use an ordinary user-data directory for this flag.

```sh
cd ../journal
flutter test integration_test/task_recovery_device_test.dart -d DEVICE_ID --no-uninstall --dart-define-from-file=/absolute/isolated/r01-phone/device-config.json
```

When stdout prints `R01_FORCE_CLOSE_READY <id> queued` (the acceptance state), immediately run `adb -s DEVICE_ID shell am force-stop com.lewiseman.journal` externally. The first Flutter command intentionally loses its driver connection and exits unsuccessfully; that is the fault-injection boundary, not a passing test. Rerun the same Flutter command without uninstalling. It detects its isolated persisted marker and checks the same identity, zero new POSTs, a completed preview through history, unchanged source, deleted-source warning and result acknowledgment. It then cleans its isolated notes/references/trust. It also saves `r01-device-evidence.json` in the phone's app support directory.

The first launch waits indefinitely within a six-minute test timeout if not force-stopped. Avoid Android logcat filters for the trigger: integration-test stdout travels through the VM service and may not appear under the `flutter` tag. Record desktop job timestamps and the force-stop command interval to establish that generation was still running at termination. The Samsung run in the evidence file uses this comparison. Restore a normal Flutter debug APK with `adb install -r`; do not uninstall or wipe unrelated app data.

## Verification limits

The desktop process-death demonstration and physical Android test use synthetic content and isolated stores. Unit fault injection covers cancellation orderings, expiry while a worker completes, protected-storage failures, reset and endpoint/source changes. Time-advanced expiry does not establish real 24-hour elapsed deletion. Phone LAN testing does not establish simultaneous phone/desktop WAN-disconnected operation. Physical iPhone, other desktop platforms and broad model quality remain untested.
