# Desktop prerequisites and Flutter connection

Implemented on 27 October 2026 for D02–D05 and C01–C02. The starting workspace contained D01 only; the user explicitly authorized the missing desktop prerequisites. `journal/` and `desktop/` remain separate repositories. `old/` was excluded. No Flutter journal-content transport or inference action was added.

## Model library and capabilities

The offline catalog offers 24 writing choices across Qwen2.5/Qwen3/Qwen3.5, Qwen2.5-Coder/Qwen3-Coder, gpt-oss, Gemma 3/4, Llama, Mistral, Phi-4, LFM2.5 and SmolLM3. Popular, newer and lightweight groups include single-file 4-bit variants selected for a 24 GB M5 Mac, up to Phi-4 14B (9.05 GB of weights); the coding & HTML group goes up to Qwen3-Coder 30B A3B (18.56 GB). Stable Diffusion 2.1 and SDXL 1.0 remain download-only for future image generation. Exact immutable publisher/converter revisions, byte counts and SHA-256 checksums are in `src/model.cjs` and `src/writing-models.cjs`. The dropdown shows size, memory guidance and license; the publisher button opens the pinned artifact page. Downloads start only on an explicit click. Installed writing models can be switched without another download. See [all choices and verification limits](MODELS.md). Arbitrary models, automatic updates and a generic model marketplace are unavailable.

The library distinguishes available, verified installed, partial, unloaded, loaded and failed states. Download without loading, progress, cancellation, fresh retry, load/unload and narrowly owned removal are supported. Active/accepted work blocks destructive changes. External model files are never deleted. Size and full SHA-256 are verified before atomic installation and on load. Low disk space is checked before transfer; ENOSPC is actionable. Partial transfers are discarded on failure/cancellation, while crash leftovers remain visibly incomplete. Retry starts from zero.

Installed QVAC 0.22 types were inspected for registry queries, `downloadAsset`, resumable SDK downloads, `cancel({requestId})`, `assessModelFit`, load/unload and cache deletion. This app retains D01's pinned publisher downloader to keep ownership/removal explicit and avoid registry dependence for its offline catalog. It does not claim SDK resume or use KV-cache deletion as weight uninstall. Fit is unknown until a successful native load; hardware guidance is advisory. One model is loaded and one operation executes at a time.

The newer Qwen3.5, Gemma 4 and SmolLM3 choices set QVAC's supported `reasoning_budget: 0` at load and completion to request direct answers within the existing short writing budgets. Context remains 4,096 tokens; phone and desktop operation input/output limits are unchanged. Architecture names were checked against the installed native runtime, but no new weights were downloaded or used for native inference verification.

`model.json` persists the active writing path and immutable model ID; legacy path-only selections keep using 0.5B. `assignment.json` atomically persists the implemented `text` capability against that revision and follows successful writing model changes. Image weights are download-only and do not change these files, the running model or phone readiness. Invalid or uninstalled text assignments fail. Actual worker/model/host/busy state determines readiness. Speech, image generation, image input, OCR and embeddings are not yet implemented. Accepted jobs capture their assignment rather than following later selections, and writing model changes are blocked while accepted work is queued or running.

Image downloads use a separate library transfer with progress, cancellation and the same pinned integrity checks. They can run alongside accepted phone writing work and never unload the writing worker. Image-generation support for desktop and phones remains future work; no new generation UI, phone restriction or image-generation IPC is introduced.

## Protocol v1

The opt-in HTTPS service uses IPv4 port 47921 and Bonjour `_journal-ai._tcp`. No cloud relay, SDK administration, arbitrary commands, public exposure or router configuration is provided. Discovery name/ID/version/fingerprint TXT are untrusted hints. An IP or discovered name cannot authorize a phone.

A two-minute QR/full code contains `{v,id,name,pin,endpoints,secret,expires}`. `pin` is SHA-256 of the exact TLS certificate DER; `secret` is a random 256-bit one-use enrollment secret. The phone shows the intended identity before enrollment. The full code is a practical fallback carrying the endpoint and pin; a short number cannot locate a computer. Transfer it privately, out of band. A fresh QR invalidates previous enrollment and pending approvals.

The phone generates an independent Ed25519 key and signs UTF-8 `pair-v1\n<server UUID>\n<QR secret>\n<base64 raw public key>\n<phone name>`. `POST /v1/pair` receives `{secret,name,publicKey,proof}`. Five invalid attempts expire the secret. A valid signature consumes it and creates a two-minute temporary approval ticket. `POST /v1/pair-status {ticket}` returns pending/approved/denied. The desktop explicitly approves after comparing the first twelve hex digits of the phone-key SHA-256. No permanent credential is returned. Device ID is the first 32 hex digits of that hash.

All requests declare `X-Journal-Version: 1`; mismatches receive HTTP 426. `GET /v1/info` returns only protocol and desktop ID. `GET /v1/challenge` supplies a random one-use thirty-second nonce, held only in memory. Authenticated calls include `X-Journal-Device`, `X-Journal-Nonce` and base64 `X-Journal-Signature`, signing:

```text
v1\n<device ID>\n<METHOD>\n<exact path>\n<nonce>\n<hex SHA-256 of exact UTF-8 body, or empty bytes>
```

Nonces are consumed on authentication attempts and cannot replay after restart. Trust is checked for every request. Browser Origin/fetch requests are refused without CORS. Bodies are limited to 8 KiB, headers to 4 KiB, requests to 120 per source IP/minute, with bounded challenge and device maps. Diagnostics omit secrets, private content and raw paths.

| Route | Signed operation |
| --- | --- |
| `GET /v1/status` | Current verified identity, transport and capability readiness |
| `POST /v1/disconnect {}` | Mark disconnected; retain trust and jobs |
| `POST /v1/forget {}` | Revoke this phone and delete retained work |
| `POST /v1/jobs {id,operation:"text",prompt}` | Durably accept bounded text work |
| `GET /v1/jobs/<id>` | Only this device's status/result |
| `POST /v1/jobs/<id>/cancel {}` | Explicit cancellation |
| `POST /v1/jobs/<id>/ack {}` | Remove terminal work |

TLS uses Node's established crypto/TLS components and a persistent EC P-256 self-signed certificate. Flutter verifies the QR/stored certificate pin **before handing the socket to HTTP**, so headers/credentials are not sent to an altered identity. Public roots, redirects, TXT records and address changes cannot replace trust. The client permits only local IPv4 endpoints. IPv6-only networks are unsupported initially. Expired/changed certificates require explicit recovery. A compromised OS account/device, malicious administrator or denial of service is outside this trust boundary. QR theft can request enrollment but still needs desktop approval. The unsigned preview needs stable signing before distribution for predictable Keychain access across app updates.

## Persistence and work lifecycle

Desktop identity, phone public keys and jobs live in `devices-and-jobs.enc`, encrypted through Electron 45 **async** safeStorage backed by macOS Keychain. Missing OS protection fails closed for the phone service. Transactions clone state, encrypt, fsync a 0600 temporary file, rename and fsync the directory before acceptance is exposed. Failed persistence does not update accepted in-memory state.

Job identifiers/deduplication are device-scoped. Reusing an ID with different input fails. Limits are four active jobs/device, sixteen overall and 1,000 retained records. Detachment never cancels acceptance. Queued/completed jobs survive restart; running jobs become `interrupted`, discard input and require explicit retry with a new ID. Inputs are removed at terminal states. Results have 24-hour retention from creation, enforced for access, at startup and each running minute. A quit app cannot delete at an exact wall-clock deadline. Acknowledgment removes terminal work. Revocation cancels active work, deletes that device's records and prevents result access. Activity displays device, operation, captured model, state and elapsed time, without private text or invented percentages. Sleep/quit does not promise execution.

Flutter stores each computer's seed, public key, certificate pin and trust only in `flutter_secure_storage`. Android uses namespace `journal_companion`, KeyStore-backed RSA-OAEP wrapping and AES-GCM, with reset-on-error disabled. Its value/configuration/wrapped-key preferences are excluded from cloud backup and device transfer. iOS uses non-synchronizable `unlocked_this_device` Keychain items. No keys enter CacheStorage, ObjectBox, Drive or sync_wise. Account and cloud sync behavior remain independent. Disconnect persists connection suspension. Offline Forget explains that desktop revocation is still required. Identity replacement requires explicit forgetting and fresh verification.

## Flutter structure and permissions

The connection is a Riverpod Notifier initialized from the existing root provider scope, with a Settings page reached through the existing Navigator convention. NetworkService events are retry hints; authenticated probes establish reachability without contacting public internet. Connected status refreshes every fifteen seconds. Recovery makes three bounded attempts with one ten-second Bonjour scan, then exposes Retry. Backgrounding stops timers/scans and clears readiness; foreground/network changes start recovery. New endpoints are saved only after the stored identity verifies.

Installed Flutter 3.47.5/Dart 3.13.4 sets compile/target SDK **36**, minimum **24**. At this target INTERNET grants LAN access. Android 17 requires runtime ACCESS_LOCAL_NETWORK when **targeting 37+**, not merely when running on Android 17. Android 16's opt-in restriction uses NEARBY_WIFI_DEVICES. Revisit permissions before raising the target. Bonsoir contributes native NSD and multicast-state permission.

Camera permission is requested only on Scan. Bundled ML Kit avoids a first-use model download; denial has a full-code fallback. iOS declares NSCameraUsageDescription, NSLocalNetworkUsageDescription and the exact Bonjour service. Native Bonjour is used instead of arbitrary raw multicast. Discovery timeout is not misreported as proven permission denial; recovery explains system Settings and network isolation.

Pinned additions: Bonsoir 7.1.6, mobile_scanner 7.4.2, flutter_secure_storage 11.2.0 and cryptography 2.9.0; desktop bonjour-service 1.4.4, qrcode 1.5.4, selfsigned 5.5.0. QVAC 0.22.0, Electron 45.0.0 and Forge 7.11.2 remain. Zod is patched to 4.6.6 via a compatible override. Existing Forge/node-gyp archive-tool advisories remain in the pinned build tree; archive extraction/admin operations are not exposed to LAN clients. No forced major upgrade was performed.

## Reproduce verification

`npm test` covers deterministic TLS/approval/auth/replay/version, protected transactions, deduplication/isolation/cancellation/restart, assignment and disk/download failures. Synthetic protectors/runtime adapters in these tests are not native inference evidence.

```sh
cd desktop
npm run package
npm run verify:connection -- /absolute/empty/evidence-directory /absolute/verified/model.gguf
```

The explicit CLI-only harness starts the packaged app twice with isolated data, uses real QVAC through signed HTTPS, retries a lost acceptance, checks encrypted files, retrieves the result after desktop restart, and revokes/cleans up. Its synthetic client's key is encrypted in the vault between runs and then removed. Reports contain synthetic output and checks. Advanced-clock expiry is labelled. D01's packaged inference/worker/isolation verification also remains available. Its all-IP-blocked offline harness cannot simultaneously prove a Wi-Fi phone connection.

For a phone run, create an isolated directory with `app-data/model.json` containing `{"path":"/absolute/verified/model.gguf"}`. Launch the packaged executable with `--connection-demo=/absolute/phone-evidence`. This explicit test mode writes a private short-lived `device-config.json` when Create pairing QR is clicked; never commit it.

```sh
cd journal
flutter test integration_test/companion_device_test.dart -d DEVICE_ID --no-uninstall --dart-define-from-file=/absolute/phone-evidence/device-config.json
flutter test integration_test/companion_device_test.dart -d DEVICE_ID --no-uninstall --dart-define=COMPANION_RESTART=true
```

The first run uses the real full-code UI and requires desktop approval. `COMPANION_DIRECT_PAIR=true` optionally bypasses live-test dialog timing for subsequent controller/storage tests; it must be reported separately. **Use `--no-uninstall`: default integration-test teardown erases Android credentials.** For replacing the test entry point with a normal debug APK while retaining data, use `adb -s DEVICE_ID install -r build/app/outputs/flutter-apk/app-debug.apk`. The `flutter install` command uninstalls first and removes credentials; the final normal-build installation in this task therefore starts fresh. Normal app use needs no test configuration: Settings → Local AI computer → Scan/Paste.

For endpoint rediscovery, restart the isolated companion with the same data and `--demo-port=47922`, then run the phone restart test. This changes a real port, not a DHCP address. For actual WAN-offline evidence, disable WAN/cellular fallback while retaining Wi-Fi, verify external literal-IP TCP connections fail on both devices, then repeat pairing/restart. Guest Wi-Fi, VPNs and hotspots may block multicast or unicast. QR bypasses discovery, never routing isolation.

## Evidence and limits

The packaged macOS arm64 app passed secure-API real QVAC inference, lost-ack deduplication, encrypted-at-rest inspection, completed-result retrieval after restart, renderer approval, identity/version mismatch and revocation cleanup. Final reports are under ignored `evidence-local/connection-native-release/`; cancellation also verified that the model remained ready. Clean quit marks running jobs interrupted; a deterministic late-completion race test verifies this cannot be overwritten. Existing D01 packaged inference/worker recovery also passed.

A physical Samsung **SM-S928B**, Android **17**, paired over IPv4 Wi-Fi to the packaged companion using full-code UI and desktop-approved trust. It rejected an unauthorized identity and stale QR. No emulator forwarding or journal content was involved. Three retained-app runs verified native Bonjour discovery, protected storage, authenticated readiness, disconnect/reconnect, a cold phone-app restart, and a cold desktop restart on a changed port (47921 → 47922) with the same verified identity. Retained pairing used the test controller with the full QR; the initial run used the actual Paste/Verify UI. [Compact sanitized evidence](connection-evidence.json) records these separately.

The unsigned iOS build passed (`flutter build ios --no-codesign --debug`), including native plugins. No physical iPhone permission/camera/Keychain verification was available. The user could not disable router WAN, so **phone pairing with internet unavailable remains unverified**. Physical camera capture, DHCP address changes, network switching and hotspot operation need additional device/network coverage. Deterministic address/lifecycle/version/identity tests must not be described as physical network tests.

Eighteen Node tests and twenty focused Flutter connection/settings/account tests passed, including the protected-storage/lifecycle startup race. Two existing onboarding large-text layout cases failed at 320×568 and 844×390; onboarding source was not modified. Injected runtime, disk and cancellation failure tests are distinct from native evidence.

## Primary sources

Installed Flutter/Dart/plugin sources and Electron 45 types were inspected alongside these primary references:

- [Android LAN target/permission matrix](https://developer.android.com/privacy-and-security/local-network-permission), [Flutter Android LAN guidance](https://docs.flutter.dev/platform-integration/android/local-network-permission).
- [Apple TN3179: local network privacy and Bonjour](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).
- Versioned package documentation: [Bonsoir](https://pub.dev/packages/bonsoir/versions/7.1.6), [scanner](https://pub.dev/packages/mobile_scanner/versions/7.4.2), [secure storage](https://pub.dev/packages/flutter_secure_storage/versions/11.2.0), [cryptography](https://pub.dev/packages/cryptography/versions/2.9.0).
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), cross-checked against installed 45.0.0 async APIs.
- [QVAC 0.22 SDK](https://docs.qvac.tether.io/sdk/js-ts-sdk/), [download lifecycle](https://docs.qvac.tether.io/sdk/models/download-lifecycle/), [fit assessment](https://docs.qvac.tether.io/sdk/models/assess-model-fit/), plus installed registry/download/cancel definitions.
