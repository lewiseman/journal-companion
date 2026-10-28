# Journal Companion

A small Electron companion for **macOS arm64**, with **20 writing model options** across Qwen, Gemma, Llama, Mistral, Phi, Liquid AI and SmolLM. The picker groups popular choices, newer models to try and lightweight options, with sizes and memory guidance selected for an **M5 MacBook Pro with 24 GB unified memory**. **Stable Diffusion 2.1 / SDXL 1.0** weights are also available to download for future image generation. It includes a bounded model library, writing assignment, secure phone pairing and encrypted durable text jobs. Read [the current contract, setup and verification limits](docs/CONNECTION.md).

## Run and package

Use Node 24.9+ and npm 10.9+ on Apple Silicon with macOS 14+. Allow several GB for development dependencies/build output, plus space for each chosen model. At least 4 GB RAM is required; the picker suggests 8–24 GB for larger choices. Writing downloads range from about 491 MB to 9.05 GB. Memory guidance is advisory; the OS, other apps and inference cache also share unified memory. Initial npm/Electron installation requires internet.

```sh
cd /Users/lewis/Dev/Projects/Journal/desktop
npm ci
npm start
```

Use **Choose a model** to compare writing and image options, download sizes and suggested memory. For writing models, **Download & use** downloads the pinned artifact from its listed publisher/converter on Hugging Face and loads it. **Use downloaded model** switches to installed writing weights without downloading again. You can also select the matching writing GGUF from disk or download without loading. The active writing model and assignment are remembered; other downloads stay on disk. Load verifies the full SHA-256 each time. Unload frees inference resources; quit releases the worker. See [all choices, publisher licenses and verification limits](docs/MODELS.md). Gemma 3 uses Google's Gemma Terms; Gemma 4 uses Apache 2.0. Llama uses Meta's community licenses, Liquid AI uses the LFM Open License, Qwen 2.5 3B uses a research license, and image weights use Open RAIL++-M. Built with Llama.

Image entries have a **Download** action only. Their transfers run separately, with progress, cancellation and checksum verification, and leave the active writing model and phone writing availability unchanged. Image generation can be connected to desktop and phone workflows later. No weights are downloaded automatically.

For authenticated Hugging Face downloads during development, copy `.env.example` to `.env` and set `HF_TOKEN`. `npm start` loads that file into the main process; restart after changing it. The downloader sends the token only to `https://huggingface.co`, never to its CDN redirects or the renderer. Real `.env` files are ignored by Git and excluded from app packages. Packaged apps can instead inherit `HF_TOKEN` from their launch environment.

```sh
npm test
npm run package
npm run make
```

The app is created at `out/Journal Companion-darwin-arm64/Journal Companion.app`; `make` also creates a ZIP under `out/make/zip/darwin/arm64/`. This is an **unsigned local preview**, not a notarized release. Linux, Windows and Intel Macs are unsupported in this milestone. Renderer sandboxing is enabled in both development and packaged builds.

## Privacy and files

The app never reads the Flutter database. It sends no prompt or response to the internet. Desktop demo text stays in memory until clear or quit; accepted phone jobs use encrypted, bounded persistence described in the connection contract; OS swap/crash handling is outside this promise. Model selection, QVAC configuration/cache and downloaded weights are stored under Electron's `userData` directory (`~/Library/Application Support/Journal Companion` in a packaged normal launch). Selected external weights are read without modification. The UI never receives their filesystem path.

The model downloader runs only on an explicit click, permits HTTPS redirects within Hugging Face hosts, verifies the pinned size/checksum, and renames the temporary file only after verification. Interrupted transfers are discarded and can be retried from the beginning. The app lists installed catalog models and can remove the active owned model after unloading it; external files are never deleted. Download resume and arbitrary model discovery are unavailable. The app does not expose QVAC administration or enable model seeding. Its opted-in phone service uses pinned TLS, per-device signing and desktop-approved trust. No telemetry, remote fonts, updater or renderer web access is configured.

## Source control

`desktop/` is an **independent Git repository**, initialized for this work. The workspace parent remains unversioned, and `journal/` retains its existing independent history. Add this repository to your preferred remote when ready; no remote or commit was created. Track source, tests, documentation and `package-lock.json`. Dependencies, generated QVAC bundles, model weights and packaged output are ignored. The Flutter connection lives in the existing, independently versioned journal/ repository.

Read [D01 implementation and evidence](docs/D01.md) for architecture, exact versions, source references, verification instructions and platform limits.

F01 saved-note summaries now use the same secure task service. See [summary limits and native verification](docs/SUMMARY.md).

R01 [task recovery](docs/RECOVERY.md) adds durable acknowledgment/expiry receipts, cancellation fences, and packaged crash/restart verification for Flutter’s local task history.

N01 adds [bounded reviewable writing operations](docs/NOTES.md) through the existing text assignment and durable device jobs.

H01 adds [safe presentation proposals](docs/PRESENTATION.md) with grammar-constrained source-slot HTML and independently validated native rendering on Flutter.

J01 adds [diary-day suggestions](docs/DIARY.md): a grammar-constrained title/mood/themes operation on the same durable job service.

## Android voice

Android microphone capture, duplex Whisper transcription, reviewed Notes/Flow text, and recoverable typed/spoken-input diary conversation are described in [VOICE.md](docs/VOICE.md). Load a multilingual Whisper model plus Silero VAD in the companion. Replies use text fallback; synthesized playback is unavailable. The guide records measured latency, retention/acceptance boundaries, setup, tests, and unverified physical-device/language coverage.
