# I06 companion note backgrounds

`src/background.cjs` adds `generate-note-background` on the existing durable job path, with its own capability `image` (`backgroundContract: 1`).

## Readiness and assignment

The two catalog entries that were "download for future use" (Stable Diffusion 2.1 Q8_0, SDXL 1.0 Q4_0) can now be **assigned** to backgrounds under Companion → Note backgrounds (`image-assignment.json`). Status is:

- `needs_download`, then `unassigned`;
- `insufficient_memory` when the Mac has less than ~90% of the model's memory guidance (SDXL needs 16 GB);
- `untested`, then `ready` only after **Run generation test** produces a valid 256×256 PNG from the real model;
- `failed` if that test fails; `busy` while generating.

Phones see this in `/v1/status`. The catalog label alone never enables the feature.

## Request, privacy and output

- Prompt is exactly `{prompt ≤240 chars, tone: light|dark}`: what the person typed, never note text. The companion appends fixed styling (abstract, low-contrast, empty space, no text) and a negative prompt (text, watermarks, people/faces, NSFW).
- Model settings per entry: SD 2.1 `prediction: 'v'`, 512×768; SDXL 768×1152. 20 steps, `euler_a`, cfg 7, random seed (returned).
- Each request verifies SHA-256, loads the model (~10 s), generates (~40 s on this Mac) and always unloads. Progress ticks update the job (`progress: {step, total}`) at most every 2 s.
- **Cancel:** QVAC 0.22's `cancel()` does not interrupt sdcpp generation (tested). The job's cancel therefore unloads the model through a runtime `stopActive` hook, which stops it within about 1.5 s and leaves the writing runtime alone.
- The PNG is checked (magic, dimensions, ≤4 MB) and stored **encrypted** in `image-output/<device>-<id>.enc`, never in the vault. The job text carries only `{width, height, seed, bytes, sha256, model}`. The owning device collects it from `GET /v1/image-jobs/<id>/result`. The file is deleted when the job is acknowledged, expires (24 h), is cancelled or fails, or the device is removed.
- `@qvac/sdk/sdcpp-generation/plugin` is added to `qvac.config.json` and the runtime config: the bundled worker otherwise fails with "Plugin not found".

## Verification

```sh
npm test                                   # 95 tests
node scripts/verify-background.cjs /absolute/new/empty/dir "$HOME/Library/Application Support/Journal Companion"
```

Unit tests (fake SDK) cover input/prompt composition, readiness (download/assignment/memory/self-test/failure), unload-to-cancel, encrypted storage and collection, sweep after acknowledgment and expiry, and the signed result route (owner only, 900 KB response).

[background-evidence.json](background-evidence.json) is a **real** run: assignment → test passed (5 s) → `ready`; two backgrounds (light and dark) generated in ~39 s each with progress, collected with matching SHA-256 and acknowledged. A third was cancelled at step 2 and stopped 1.5 s later; no output files remained. The images are `i06-background-0.jpg` and `-1.jpg`.

## Limitations

- SD 2.1 sometimes draws text-like marks despite the negative prompt, and follows the light/dark tone loosely. Users preview and must accept explicitly.
- SDXL was not run here (not downloaded); it is gated by memory and the same test.
- No content moderation beyond the negative prompt and the user's explicit acceptance.
