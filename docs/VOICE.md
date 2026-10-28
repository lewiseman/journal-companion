# Android voice capture and diary conversation

Implemented 28 October 2026 against Flutter's existing repositories and Electron 45 / QVAC SDK 0.22.0 / ws 8.22.0. `journal/` and `desktop/` are separate Git repositories. No `old/` source is used.

## Use it

1. Start the updated companion with `npm start` from `desktop/`. Its prestart step regenerates the worker with Whisper support; Forge does the same when packaging.
2. Download **Whisper Large v3 Turbo** and **Silero VAD 5.1.2** from the existing model picker. In **Voice from Android**, select Whisper in its dedicated **Speech recognition model** picker, then click **Load speech + Silero VAD**. The writing-model picker is independent. Downloads and model loading are separate actions. English-only Whisper, Parakeet, MOSS and TTS models cannot be selected for this multilingual voice path.
3. For diary follow-ups, also load/assign a capable writing model. **Llama 3.1 8B Instruct Q4_K_M** was tested. The 0.5B writing model failed the initial conversation-quality probe; do not treat all downloadable writing models as equally capable. Load writing first, then speech: replacing/unloading the writing runtime unloads speech and requires loading it again.
4. Pair the Android app with the computer in **Settings → Local AI computer**, using the existing QR, certificate verification and desktop approval. Use the same routable Wi-Fi/LAN.
5. In Notes, tap **Transcribe a voice note**. In Flow, tap the empty composer's microphone. Tap **Record** and grant Android microphone permission at use. Text appears after short pauses. **Pause / review** finishes that recording; **Continue recording** starts a new, distinct audio segment and retains the reviewed prefix. **Use transcript** inserts text into the unsaved note editor; the existing note Save action still owns the write. **Save thought** creates one Flow item through its normal repository/outbox.
6. The diary microphone opens a real typed conversation. **Record** opens Android capture; review the transcription before inserting it into **Your words**. **Send** accepts it as a user turn and requests a follow-up. You can correct user turns, request a draft at any point, edit/reject it, and save explicitly. **Request an English draft** is off by default. Only user statements are passed to final drafting; assistant questions are omitted entirely.

**Live talk (`/v1/talk/live`).** The diary talk page keeps one authenticated WSS session (`src/talk.cjs`) for the whole conversation. The phone sends `start` with its turns (and recent diary entries when there are none), then audio frames only after `listen`. The companion ends the turn after 1.2 s of quiet, judged by loudness against the room's noise floor, once Whisper has emitted a segment after the last speech (3 s of quiet ends it regardless; `done` ends it at once). It then sends `endpoint`, the final `turn`, `thinking`, streamed `token`s and a checked `reply`. Only one talk session runs at a time, queued jobs and voice recovery wait while it is open, and nothing in it is stored on the computer: if the connection drops, the turn in progress is lost and the phone reconnects with the turns it kept.

The companion opens a new diary conversation (`action: open`, no turns, plus up to 12 recent `diary` entries with `daysAgo` 0–7) with one question that may follow up on something the person wrote. Replies are shown as text and read aloud by the **phone's** system text-to-speech; the desktop does not synthesize audio. The phone stops playback before opening the microphone so assistant audio does not feed back into capture. Barge-in (interrupting playback by speaking) is not implemented. No fluent multilingual spoken-assistant claim is made.

## Latency and audio choice

Android `AudioRecord`, `VOICE_RECOGNITION`, mono **16,000 Hz signed PCM16 little-endian**, about **100 ms per frame**. This is 32 KB/s (256 kbit/s) on the LAN. Uncompressed PCM avoids codec startup, FFmpeg, repeated TLS connections, and file decoding. It trades a modest LAN bandwidth cost for a simple low-latency path. It is not a cellular-optimized codec.

A single authenticated WSS connection carries binary audio and transcript/ack control events. Whisper runs through QVAC's **actual duplex `transcribeStream`**, with `translate:false`, English (`language: 'en'`), greedy decoding, `single_segment:true`, Silero VAD at 350 ms silence and an 8-second maximum utterance. Whisper emits utterances, not continuous word-by-word hypotheses. Text is provisional until the complete recording finishes and is always reviewed before an application write. No batch output is animated to imitate streaming.

A real-runtime probe on this 24 GB Apple Silicon Mac used a public 11-second JFK recording plus one second of silence. First text appeared at approximately **4.2 seconds from audio start**, with later utterances during capture; final output arrived approximately **0.34 seconds after all audio was sent**. This measures the fixture, model, local TLS/WebSocket and host, not a universal phone latency guarantee. Continuous speech, noise, language detection and smaller/faster models change results.

QVAC's Whisper VAD restarts native IDs and timestamps for each utterance. The adapter gives each completed utterance a session-wide ID before transport. Transport/UI segment updates replace by that ID, and retry retrieves the accepted job rather than appending its text again. Native timestamps are utterance-relative and are not represented as an absolute recording timeline.

## Acceptance, recovery and retention

- Each connection is bound to the existing pinned TLS identity and an Ed25519 signature over a one-use challenge, HTTP upgrade route and empty request digest. Browser origins are rejected; no trust credentials are sent before the phone verifies the certificate. TLS 1.2+ and the existing trust/revocation service remain authoritative.
- Frames have consecutive sequence numbers. The mobile in-flight window is bounded at about two seconds; if it fills, recording stops and the original phone audio is retained. Stop sends total bytes, frame count and SHA-256. Maximum complete recording: **10 minutes / 19.2 MB**. One speech session runs at a time.
- Frame acknowledgment means receipt, **not durable acceptance**. A complete matching recording is encrypted with macOS `safeStorage`, written/fsynced/renamed in the companion-owned `voice-input` directory, and then committed to the protected task manifest. Only then is `accepted` sent. A lost acceptance reply is recovered by the same device/job ID.
- Accepted work finishes after socket closure. On desktop restart, complete accepted audio is replayed to ASR; partial/unaccepted socket input is discarded. No missing conversation is fabricated. Terminal input audio, including failed work, is removed. Cancel receipts fence delayed resubmissions. Jobs and transcripts expire after 24 hours; minimal receipts persist another seven days. Expired data is hidden immediately and physical cleanup runs each minute while the companion runs.
- Android writes original audio to app-private `files/voice_sessions`, excluded from cloud backup and device transfer. Audio bytes are not ObjectBox/Drive attachments and are never sent through `sync_wise`. Reviewed local transcripts/conversations and retry identity use the existing protected-storage namespace. Phone audio is deleted when consumed/discarded; 24-hour-expired audio is removed the next time voice opens. An inactive mobile process cannot promise timed physical deletion.
- A disconnect/background event stops recording. Before acceptance, reopen and explicitly resend the retained recording from its beginning; do not silently assume the desktop has it. After acceptance, **Retrieve result** obtains the existing task. A terminal failure also offers **Transcribe original again**, an explicit new task using retained phone audio; ordinary reconnects never rerun the old task. Review text is recoverable even if speech service/model becomes unavailable. Clearing offline deletes local data immediately; retained desktop work expires within 24 hours if cancellation cannot be delivered.
- Diary conversation text uses the existing durable job queue: at most 24 turns / 6,000 UTF-8 input bytes, 768 output tokens / 8,000 output bytes. Oversize input is refused without truncation. Session source and pending request identity are protected before submission. Corrections invalidate a draft. The existing date/role rules own diary saves. Stable creation IDs make repeated Flow/diary save attempts idempotent; different text under an already saved ID is refused.
- Account reset clears protected voice session keys and app-owned audio. A store generation barrier prevents late pre-reset writes from recreating the draft. No voice permission is requested at app launch.

## Evidence and reproducible checks

`docs/voice-evidence.json` contains public/synthetic fixtures only. It records actual QVAC transcription, silence, writing-plus-ASR load, an English follow-up and source-only drafting. The real writing and speech models were resident together on the 24 GB host. The worker RSS sample and main-process peak are separate metrics; GPU memory scope is unverified. These numbers are not an overall memory requirement for every model combination.

Initial verification completed: **69 companion tests, 81 focused Flutter tests, analyzer-clean changed Dart files, one native Android emulator capture test, Android debug APK build and macOS arm64 Electron packaging**. Physical-device and language-quality limits below still apply.

Run companion contract/failure tests:

```sh
cd /Users/lewis/Dev/Projects/Journal/desktop
npm test
npm run bundle:runtime
npm run package
```

Real engine/network/storage probe (downloads are explicit; replace model/fixture paths with local files):

```sh
./node_modules/.bin/electron scripts/verify-voice.cjs \
  --directory=/private/tmp/journal-voice-check \
  --models='/Users/lewis/Library/Application Support/Journal Companion/models' \
  --vad=/absolute/path/ggml-silero-v5.1.2.bin \
  --audio=/absolute/path/jfk.wav
```

The audio must be PCM16 mono 16 kHz WAV. The public-domain speech fixture is [whisper.cpp's JFK sample](https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav). Use only public/synthetic fixtures in committed evidence. The probe provisions symlinks to local weights; it does not change the installed model library.

Flutter checks:

```sh
cd /Users/lewis/Dev/Projects/Journal/journal
flutter analyze lib/modules/voice
flutter test test/voice_session_test.dart test/voice_capture_recovery_test.dart test/flow_page_test.dart \
  test/note_attachments_test.dart test/diary_day_content_test.dart \
  test/diary_conversation_test.dart test/thoughts_storage_test.dart \
  test/diary_storage_test.dart test/account_reset_integration_test.dart
flutter build apk --debug
adb -s emulator-5554 shell pm grant com.lewiseman.journal android.permission.RECORD_AUDIO
flutter test integration_test/voice_capture_android_test.dart -d emulator-5554 --no-uninstall
```

The emulator native test captured 13 frames / 38,912 bytes of actual platform PCM, verified file/frame equality, stop, and refusal of an external output path. It is microphone plumbing evidence, not human speech-quality evidence. Companion tests use a synthetic ASR engine to cover signature/browser denial, incomplete/corrupt frames, silence, segment replacement, dropped socket after acceptance, cancellation/revocation and encrypted-audio recovery across restart. Flutter tests cover existing screens/repos, stable save IDs and lost acceptance/restart of the diary conversation.

Still requires a physical-phone pilot: denied/permanently denied permission, a real call/audio interruption, microphone quality, noisy speech, English accuracy, foreground/background/reconnect while speaking, and the complete real Android-microphone-to-QVAC-to-reviewed-save path. These are not represented as completed device demonstrations. Spoken replies use the phone's system TTS. Model output still needs factual and language review; structurally excluding assistant turns is stronger than relying on prompt instructions alone, but does not eliminate model hallucinations.

Primary references, matched with installed SDK schemas and examples:

- [QVAC 0.22 transcription](https://docs.qvac.tether.io/sdk/ai-capabilities/transcription/) and [voice assistant](https://docs.qvac.tether.io/sdk/ai-capabilities/voice-assistant/).
- [Android AudioRecord](https://developer.android.com/reference/android/media/AudioRecord) and [sharing audio input / silencing callbacks](https://developer.android.com/media/platform/sharing-audio-input).


## Startup troubleshooting

If the phone shows **Try recording again** (formerly **Retry retained recording**) before the microphone ever starts, first check **Voice from Android → ready** on the companion. “Your companion is ready” at the top describes writing; speech has its own readiness state. A downloaded Whisper file alone does not load the speech model.

An unloaded speech model previously left a reservation behind on the desktop and an empty pending attempt on the phone. The fixed desktop releases failed startup reservations. The fixed phone checks whether the desktop accepted the task before resetting a genuinely empty attempt; it retains real audio and accepted receipts. Tap **Try recording again** once to reconcile an old empty attempt, then **Record**. No re-pairing or account reset is required.

The desktop regression suite includes failure before model readiness followed by a successful retry. Flutter checks cover empty-attempt recovery, retention of an accepted receipt with missing phone audio, and the actual Dart pinned-TLS/WebSocket client against the companion protocol using synthetic PCM. Those transport checks complement microphone/ASR quality testing.

Startup-fix verification on 28 October 2026: **70 companion tests and 58 affected Flutter tests passed**. The connected Samsung SM-S928B subsequently sent a six-second recording that appeared as **completed** in the running companion’s Activity. Its transcript content was not inspected and a journal save was not performed; language accuracy and reviewed-save verification remain separate checks.


## Consecutive recording readiness

The writing runtime shares its worker with speech. Its idle health monitor must not probe during ASR or act on a delayed probe from an earlier activity generation. Speech now reserves the worker, suspends writing health probes, and resumes them only after release. A late probe failure is ignored if its worker/model/generation no longer matches; a current idle failure still revokes readiness.

The real-runtime repeat probe completed four successive public-speech transcriptions plus silence, then kept writing and speech ready through 12 seconds of idle monitoring. See `voice-repeat-evidence.json`. The companion suite includes the stale-probe regression and genuine idle-failure detection (72 passing tests). Reproduce with `--repeat=4` on the voice verification command above.

The physical Samsung repeat test exposed a separate phone stop race: the MethodChannel stop reply can precede final PCM EventChannel frames. Cancelling the stream after a zero-duration delay lost those frames, so the retained file failed the complete-audio byte check. An already stopped controller also sent another global stop during disposal, potentially interrupting a newer recorder. `PcmRecorder` now owns its subscription, serializes stops, waits for the native `stopped` event after all audio frames, and makes later cleanup inert.

After that change, three consecutive native Samsung SM-S928B captures completed through the running companion, including an immediate second attempt and a third after five seconds. Each delivered 34,560 bytes matching its retained file. Both writing and transcription remained ready after 12 seconds idle. See `voice-device-repeat-evidence.json`. This is real microphone/transfer/acceptance/processing evidence, with no transcript inspection or journal save; it does not establish spoken-language accuracy.

Run `flutter test integration_test/voice_repeat_device_test.dart -d DEVICE_SERIAL --no-uninstall --dart-define=RUN_REAL_VOICE_REPEAT=true` against an already paired phone, then restore the normal APK with `adb install -r`. **`--no-uninstall` is essential:** Flutter's default removes the installed app and its local data after integration tests. A diagnostic run during this investigation omitted it and cleared this phone's test-only data; the normal app and verified pairing were restored. No journal entries are created by the diagnostic.
