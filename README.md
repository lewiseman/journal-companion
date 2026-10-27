# Journal Companion — D01

A small Electron companion for **macOS arm64**. It loads one verified Qwen2.5 0.5B Instruct Q4_K_M model through QVAC and streams a short local text response. Flutter, journal content, phone connections, a model catalog and durable jobs are outside this milestone.

## Run and package

Use Node 24.9+ and npm 10.9+ on Apple Silicon with macOS 14+. Allow about 3 GB for development dependencies, build output and the model; at least 4 GB RAM is required. Initial npm/Electron installation requires internet.

```sh
cd /Users/lewis/Dev/Projects/Journal/desktop
npm ci
npm start
```

Select **Download model** to provision 491,400,032 bytes from Qwen's official Hugging Face repository, or select that exact GGUF from disk. Other models are deliberately refused. After setup, the model selection is remembered and loads on restart without a model download. Load verifies its full SHA-256 each time. Unload frees inference resources; quit releases the worker. Nothing runs while the app is quit.

For authenticated Hugging Face downloads during development, copy `.env.example` to `.env` and set `HF_TOKEN`. `npm start` loads that file into the main process; restart after changing it. The downloader sends the token only to `https://huggingface.co`, never to its CDN redirects or the renderer. Real `.env` files are ignored by Git and excluded from app packages. Packaged apps can instead inherit `HF_TOKEN` from their launch environment.

```sh
npm test
npm run package
npm run make
```

The app is created at `out/Journal Companion-darwin-arm64/Journal Companion.app`; `make` also creates a ZIP under `out/make/zip/darwin/arm64/`. This is an **unsigned local preview**, not a notarized release. Linux, Windows and Intel Macs are unsupported in this milestone. Renderer sandboxing is enabled in both development and packaged builds.

## Privacy and files

The app never reads the Flutter database. It sends no prompt or response to the internet and stores neither in application files. Text exists in process memory and the visible window until cleared or quit; OS swap/crash handling is outside this promise. Model selection, QVAC configuration/cache and downloaded weights are stored under Electron's `userData` directory (`~/Library/Application Support/Journal Companion` in a packaged normal launch). Selected external weights are read without modification. The UI never receives their filesystem path.

The model downloader runs only on an explicit click, permits HTTPS redirects within Hugging Face hosts, verifies the pinned size/checksum, and renames the temporary file only after verification. Interrupted transfers are discarded and can be retried from the beginning. Resume, uninstall and broader inventory belong to D02. The app does not launch a public runtime server or enable model seeding. No telemetry, remote fonts, updater or renderer web access is configured.

## Source control

`desktop/` is an **independent Git repository**, initialized for this work. The workspace parent remains unversioned, and `journal/` retains its existing independent history. Add this repository to your preferred remote when ready; no remote or commit was created. Track source, tests, documentation and `package-lock.json`. Dependencies, generated QVAC bundles, model weights and packaged output are ignored. The Flutter repository is unchanged.

Read [D01 implementation and evidence](docs/D01.md) for architecture, exact versions, source references, verification instructions and platform limits.
