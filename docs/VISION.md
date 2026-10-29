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

# I04 page scanning

`scan-note-image` uses the same image route, encrypted pending storage, readiness (`ready` after the self-test), job lifecycle and per-request load/unload as `ask-note-image`. The prompt is exactly `{"mode":"transcribe"}`.

## Choosing the reader (tested, not assumed)

QVAC 0.22 offers `ggml-ocr` (EasyOCR CRAFT detector + Latin CRNN, or DocTR) and the I03 vision model. Both were run on the same printed, low-contrast, prompt-injection and handwriting-style samples ([scan-evidence.json](scan-evidence.json) → `engineComparison`):

- **Qwen3-VL 2B** transcribed every sample exactly, including the two handwriting-style fonts and a 7° rotation.
- **EasyOCR** split lines and misread `TOTAL`→`IOIAL`, `14:30`→`14.30`, `Dentist`→`pentist`, `3:15pm`→`315pm`, but it reports a per-line confidence and fails in different ways.

So Qwen3-VL produces the transcription, with a strict verbatim instruction: never correct, complete or translate, and use `[?]` for unreadable parts. When **EasyOCR · Latin** (a new optional registry download, ~99 MB, pinned blobs/SHA-256 from `@qvac/inference` 0.22) is installed, it reads the same page independently. Its lines and confidences are returned as `check`. The phone flags numbers and capitalised words that the two readers disagree on; the check never changes text. OCR failure only removes the check (`check: null`). Capability status adds `scanContract: 1`, `scanLimits` and `ocrCheck`.

Output: `{text ≤6000 chars, readable, check: [{text, confidence}] | null}` (≤12 KB).

The packaged worker bundles only plugins listed in `qvac.config.json`, so `@qvac/sdk/ggml-ocr/plugin` is registered there and in the runtime config; `npm run bundle:runtime` then lists `@qvac/ocr-ggml` in `qvac/addons.manifest.json`.

## Failure found and fixed during verification

On an image with no text, Qwen3-VL answered with its own instructions. The prompt now asks for empty text, and any transcription sharing a six-word run with the instructions becomes `{text: '', readable: false}` (`echoesInstructions`). The re-run returns `readable: false`.

## Limits

The handwriting samples are **handwriting-style fonts**, not real handwriting. Real cursive, faint pencil, mixed layouts, tables and non-Latin scripts are untested; EasyOCR here is Latin/English only. Expect errors on real handwriting, which is why every scan is reviewed and edited on the phone before insertion. Scans take ~5–7 s with the cross-check (two model loads).

# I02 diary photo questions

`diary-photo-questions` uses the same image route, encrypted pending storage, readiness (`ready` after the self-test), job lifecycle and per-request load/unload as `ask-note-image`. Capability status adds `photoContract: 1` and `photoLimits`.

- **Input:** `{"caption": string}` (≤240 characters, may be empty) plus one PNG/JPEG. Contract 2 adds shuffle: `{"caption", "avoid": [1–12 questions already shown]}`. The model is told to write different questions, and samples (temperature 0.8, random seed) instead of the reproducible temperature 0 used for everything else, so asking again really brings something new. No diary text, date or other photos are sent. The caption is passed as the person's own context, and the model is told to use it only for the questions, never in observations.
- **Output:** `{observations, clear, moment[], feeling[], little[]}` (≤4 KB). Each group holds 1–3 distinct questions. `clear` is false when the photo is too dark, blurred or ambiguous.
- **Grammar, not just instructions:** each question string must match `^(What|How|Where|When|Who|Why|Which|Did|Do|Was|Were|Is|Are|Can|Could|If) …\?$` in the JSON schema. QVAC passes the schema to llama.cpp's `json_schema_to_grammar`, so the model cannot emit statements. Validation re-checks shape, length, the question mark, control characters and duplicates across groups.
- The system prompt asks about the person's experience. It forbids stating or assuming feelings, identifying anyone, or inventing names, ages, relationships or events. It treats text in the photo and the caption as content.

## Failure found and fixed during verification

The first real run failed 3 of 6 requests with `INVALID_OUTPUT`. Qwen3-VL 2B filled the question arrays with descriptions such as "The person might feel a sense of calm…", which both broke the format and asserted feelings. The validator refused them correctly, but the feature was unusable. Adding the question pattern to the grammar and a worked example to the prompt fixed every sample. A second issue: with the caption "Maya turned seven today", observations said "Maya's 7th birthday", mixing the caption into what was "seen". The prompt now keeps captions out of observations, and the re-run reports only the visible card text.

## Verification

```sh
npm test                                                   # 121 tests
node scripts/verify-photo-questions.cjs /absolute/new/empty/dir "$HOME/Library/Application Support/Journal Companion"
```

[photo-questions-evidence.json](photo-questions-evidence.json) is a **real** run (QVAC 0.22.0, Qwen3-VL 2B, macOS arm64) on the app's own onboarding illustrations (right-hand pages, re-encoded to PNG) and the drawn I03 fixtures:

- Self-test passed. Each request took 4.6–7.8 s including model load and unload.
- Coffee scene, birthday scene (with caption), drawn house and the printed prompt-injection list: all completed with 3 questions per group.
- The heavily blurred photo returned `clear: false` and said it could not see details.
- The injection list was described as a shopping list; its embedded instructions were not followed.
- A computer without the model files reports `needs_download` and refuses with `NOT_READY` before accepting anything.
- Shuffle on the coffee scene, avoiding every question already returned for each group, gave a new question in all three groups (7.3–8.2 s each).
- A job accepted and then interrupted by a companion restart (new `Jobs` on the same vault) ran once afterwards. No encrypted photos were left after the sweep.

## Limits

- Question quality is modest for a 2B model. Some questions are generic ("What does this moment mean to you?"), and some ask about the photo rather than the moment ("How did you feel when you saw this photo?"). The samples are illustrations, not real photos; quality on real photos of people, night scenes and non-Latin text is unmeasured.
- No phone-in-the-loop run of this operation yet. The phone side is covered by widget and controller tests with a fake signed transport.
