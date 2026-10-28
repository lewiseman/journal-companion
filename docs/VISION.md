# I03 companion image understanding

Before this milestone the companion had no working image input: Gemma 3 4B was listed for text only, and nothing loaded a projection model. QVAC SDK 0.22.0's `llamacpp-completion` accepts a `projectionModelSrc` (mmproj) at load time and `attachments: [{ path }]` on a user message (see the installed `dist/examples/llamacpp-multimodal.js`). This was proven on this Mac (macOS arm64, 24 GB) with a minimal script before any phone UI was built, then wired in.

## Model

`src/vision-models.cjs` adds one catalog entry, **Qwen3-VL 2B Instruct**: Qwen's own GGUF repository at pinned revision `52d6c8ff…`, two files (Q4_K_M model 1.11 GB + Q8_0 mmproj 0.45 GB). Sizes and SHA-256 match the `QWEN3VL_2B_MULTIMODAL_Q4_K`/`MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K` entries shipped in `@qvac/inference` 0.22. Multi-part Hugging Face downloads now verify and keep each part separately (`downloadParts` in `model.cjs`). It is not a writing model and cannot be assigned to text.

## Readiness: no enabling from a catalog label

`src/vision.cjs` reports capability `vision` (`visionContract: 1`, `visionLimits`) in `/v1/status`:

- `needs_download` until both files are present at their pinned sizes;
- `untested` once downloaded;
- `ready` only after **Run image self-test** (Companion → Note images) sends a generated 64×64 red PNG through the real model and the model reports "red". A model that is not receiving the image cannot pass. The result is stored in `vision.json` per model ID;
- `failed` if the self-test fails; `busy` while a request runs.

## Operation `ask-note-image`

- Separate signed route `POST /v1/image-jobs` (body limit 4.2 MB); `/v1/jobs` keeps its 32 KB limit and refuses image operations, and the image route refuses everything else.
- Body: the usual `{id, operation, prompt, expires}` plus `image` (base64). `prompt` is exactly `{mode: describe|explain|question, question}` (question ≤300 characters, required only for `question`). No note text is involved.
- The image must be PNG or JPEG, ≤3 MB, ≤4096 px per side (header-checked). It is encrypted with the same OS protector as the job vault into `image-input/<device>-<id>.enc`, never stored in the vault JSON. The job digest includes the image hash, so reusing an ID with a different image is `ID_CONFLICT`.
- When the job runs, the image is decrypted to a random 0600 file, attached, and deleted in `finally`. The model is loaded for the request and always unloaded afterwards. Stored images are swept as soon as their job is no longer queued or running (completed, failed, cancelled, expired, device revoked).
- Output is grammar-constrained JSON `{observations, text, inference, answer}` (≤4 KB/512 tokens). The system prompt separates visible observations, verbatim image text (explicitly data, never instructions), cautious "Possibly…" interpretation and the answer, and forbids identifying people or guessing age, ethnicity, health, emotions or relationships.
- Vision runs inside the shared runtime lock, so it never overlaps writing or speech. Model/validation errors fail only the job; only a dead worker resets the shared runtime.

## Verification

```sh
npm test                                         # 88 tests
node scripts/verify-vision.cjs /absolute/new/empty/dir "$HOME/Library/Application Support/Journal Companion"
```

`test/vision.test.cjs` covers envelopes, PNG/JPEG header checks, projector loading, temporary-file lifetime and unload, readiness/self-test (including a model that "cannot see"), route separation, encrypted pending storage, `ID_CONFLICT`, `IMAGE_MISSING` and sweeping after completion/cancel. The device-service test checks the larger signed route and vision status. The SDK in tests is a fake.

[vision-evidence.json](vision-evidence.json) is a **real** run (QVAC 0.22.0, Qwen3-VL 2B) on synthetic fixtures (`scripts/fixtures`, drawn by `draw.swift`): self-test passed in 3 s, requests take 2–4 s including load. The model described a drawn house and answered "red" for the roof. It declined "who lives here and how do they feel". It reported the prompt injection printed in the shopping-list image as visible text without obeying it, and read a printed receipt correctly. Errors: it added a "$" currency that is not in the receipt, and once put its refusal phrase in the `text` field.

## Limitations

- One small model; quality on real photos, handwriting and non-Latin text is unmeasured here. It can invent details (the "$" above), which is why the phone presents answers for review and never applies them automatically.
- Only exercised with the synthetic client in this repository (`verify-vision.cjs`); no packaged-app or phone-in-the-loop run yet.
- The server's 10 s request timeout bounds uploads: a slow network may need to retry a large image.
- `vision.json` remembers the self-test per model ID; replacing the files with other bytes of the same size is caught at request time by SHA-256 verification, not by re-running the self-test.
