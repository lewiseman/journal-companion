# Local model choices

Open **Skills → Writing → Choose another** for **31 text models** across **Heavy · performance testing**, **Popular**, **Newer** and **Small & quick**; the four coding choices are under **Websites → Choose another**. Browsing never starts a download or changes the running model. **Get it** downloads and loads a writing model, **Download only** saves it for later, and **Use** switches to installed weights. Each card shows the pinned download size, suggested system memory, fit guidance and publisher license. Image, speech, vision and search choices remain available in their own skills.

## Choosing for an M5 MacBook Pro with 24 GB memory

These are released, downloadable models, including newer families to explore. For a first comparison, Qwen3 4B Instruct 2507 is a compact direct-answer option; Llama 3.1 8B and Qwen3.5 9B are middle-sized choices; Gemma 3 12B and Mistral NeMo 12B offer a larger-capacity comparison. Phi-4 14B and Qwen3 14B offer a dense 14B comparison. The Heavy group extends this to dense 24–32B models and 30–35B mixtures of experts. These are size-based starting suggestions, not benchmark rankings.

Ordinary writing choices stay below 10 GB. Coding and Heavy experiments extend to 22.02 GB; all Heavy entries use Q4_K_M quantization. A 24 GB Mac still needs room for macOS, other apps, the runtime and its inference cache. The app keeps a 4,096-token context rather than allocating the models' advertised maximum contexts. Close memory-heavy apps for the 12–14B choices. Memory suggestions are advisory, and actual fit is confirmed only by a successful load; no speed or quality benchmark is claimed.

## Writing · popular choices

| Option | Download | Suggested system memory | License |
| --- | ---: | --- | --- |
| Llama 3.2 3B Instruct Q4_K_M | 2.02 GB | 8 GB+ | Llama 3.2 Community |
| Llama 3.1 8B Instruct Q4_K_M | 4.92 GB | 16 GB+ | Llama 3.1 Community |
| Mistral 7B Instruct v0.3 Q4_K_M | 4.37 GB | 16 GB+ | Apache 2.0 |
| Mistral NeMo 12B Instruct Q4_K_M | 7.48 GB | 16 GB+ | Apache 2.0 |
| Phi-4 mini 3.8B Instruct Q4_K_M | 2.49 GB | 8 GB+ | MIT |
| Phi-4 14B Q4_K | 9.05 GB | 24 GB+ | MIT |
| Gemma 3 12B Instruct Q4_K_M | 7.30 GB | 16 GB+ | Gemma Terms of Use |
| Qwen3 4B Instruct 2507 Q4_K_M | 2.50 GB | 8 GB+ | Apache 2.0 |

## Writing · newer & interesting

| Option | Download | Suggested system memory | License |
| --- | ---: | --- | --- |
| Gemma 4 E2B Instruct Q4_K_M | 3.46 GB | 8 GB+ | Apache 2.0 |
| Gemma 4 E4B Instruct Q4_K_M | 5.41 GB | 16 GB+ | Apache 2.0 |
| Qwen3.5 4B Q4_K_M | 2.74 GB | 8 GB+ | Apache 2.0 |
| Qwen3.5 9B Q4_K_M | 5.68 GB | 16 GB+ | Apache 2.0 |
| LFM2.5 1.2B Instruct Q4_K_M | 731 MB | 4 GB+ | Liquid AI LFM Open License 1.0 |
| LFM2.5 2.6B Q4_K_M | 1.67 GB | 8 GB+ | Liquid AI LFM Open License 1.0 |
| SmolLM3 3B Q4_K_M | 1.92 GB | 8 GB+ | Apache 2.0 |

Gemma E2B/E4B names describe effective compute, not total resident weights. The listed download sizes include the complete language-model file. Qwen3.5, Gemma 4 and SmolLM3 are configured with QVAC's `reasoning_budget: 0` at load and completion so their reasoning channel does not consume the app's short answer budget. This option is supported by the installed SDK/native types and checked with synthetic runtime tests; real output behavior still requires the user's native testing.

## Writing · coding & HTML

| Option | Download | Suggested system memory | License |
| --- | ---: | --- | --- |
| Qwen2.5-Coder 7B Instruct Q4_K_M | 4.68 GB | 16 GB+ | Apache 2.0 |
| Qwen2.5-Coder 14B Instruct Q4_K_M | 8.99 GB | 24 GB+ | Apache 2.0 |
| gpt-oss 20B MXFP4 | 12.11 GB | 24 GB+ | Apache 2.0 |
| Qwen3-Coder 30B A3B Instruct Q4_K_M | 18.56 GB | 24 GB+ | Apache 2.0 |

These are coding-tuned choices for simple, self-contained HTML and CSS. Choose one under **Note websites** to build the websites phones ask for: for each request the writing model is unloaded, the coding model loads and builds the page, and the writing model loads again (each file's checksum is verified once, then reused while the file is unchanged). Every other request keeps using the writing model; with no coding model chosen, websites use the writing model too. Coding and Heavy groups allow text files above 10 GB. gpt-oss and Qwen3-Coder are mixture-of-experts models: only a few billion parameters are active per token, so they generate quickly, but the whole file must still fit in memory. Qwen3-Coder 30B is at the edge of a 24 GB Mac, because macOS normally leaves only part of unified memory to the GPU; quit other apps before loading it and expect that it may fail under memory pressure. gpt-oss uses `reasoning_budget: 0` for direct answers like the other reasoning-capable choices. The `qwen3moe` and `gpt-oss` architecture names were found in the installed native runtime; output quality and fit still need the user's native testing.

## Writing · heavy performance testing

| Option (Q4_K_M) | Download | Suggested system memory | License |
| --- | ---: | --- | --- |
| Qwen3 14B | 9.00 GB | 24 GB+ | Apache 2.0 |
| Mistral Small 3.2 24B Instruct | 14.33 GB | 24 GB+ | Apache 2.0 |
| Gemma 3 27B Instruct | 16.55 GB | 24 GB+ | Gemma Terms of Use |
| Qwen3.5 27B | 16.74 GB | 24 GB+ | Apache 2.0 |
| Qwen3 30B A3B Instruct 2507 | 18.56 GB | 24 GB+ | Apache 2.0 |
| Qwen3 32B | 19.76 GB | 32 GB+ | Apache 2.0 |
| Qwen3.5 35B A3B | 22.02 GB | 32 GB+ | Apache 2.0 |

Start with Qwen3 14B, then compare Mistral Small 24B and a 27B choice. A3B indicates roughly 3B active parameters per token, while the full weight file still needs memory. The 16–19 GB choices have limited headroom on a 24 GB Mac; the 19.76 GB and 22.02 GB options suggest 32 GB or more. Guidance is advisory, and every choice remains selectable for experiments. Quit memory-heavy apps before loading; loading can fail or macOS can swap. Multimodal models are used for text only. Qwen3 14B/32B and Qwen3.5 use `reasoning_budget: 0`; the 30B Instruct 2507 variant is designed for direct answers.

Under **Writing → Try it**, click **Compare speed** to fill the same short writing prompt, then send it. Each successful response records the selected model, time to first nonempty text, total response time, and the engine's per-request tokens/s and generated token count when provided. Missing statistics display as a dash; stream chunks are never counted as tokens. The last six successful trials stay in memory across model switches, and **Clear** removes them. No prompts or trial history are persisted. The latest timing notes when output reaches the 192-token cap. Use the same prompt and comparable background app load for each trial; generation is seeded but sampling and actual output lengths can differ. These are local interactive comparisons, not published benchmark rankings.

First-text and total timings use a monotonic clock in the desktop main process and include request processing, but exclude model verification/loading. Text loads allow up to 180 seconds after checksum verification; Heavy desktop trials allow 180 seconds to complete. Existing phone operation limits stay unchanged. Engine-reported tokens/s measures native generation and can differ from whole-response throughput.

Heavy metadata was verified against the pinned Hugging Face publisher/converter APIs on **2026-10-29**. The installed Apple Silicon llama.cpp binary contains `qwen3`, `qwen3moe`, `qwen35`, `qwen35moe` and `gemma3` architecture names. This establishes architecture availability, not successful native inference for each file; no Heavy weights were downloaded during implementation.

## Speech to text · download only

| Option | Download | Engine | Source | License |
| --- | ---: | --- | --- | --- |
| Whisper Large v3 Turbo F16 | 1.62 GB | whisper.cpp | Hugging Face | MIT |
| Whisper Large v3 Turbo Q8_0 | 874 MB | whisper.cpp | Hugging Face | MIT |
| Whisper Large v3 F16 | 3.10 GB | whisper.cpp | Hugging Face | MIT |
| Whisper Medium Q8_0 | 823 MB | whisper.cpp | Hugging Face | MIT |
| Whisper Small Q8_0 | 264 MB | whisper.cpp | Hugging Face | MIT |
| Whisper Base (English) Q8_0 | 82 MB | whisper.cpp | Hugging Face | MIT |
| Silero VAD v5.1.2 (live-capture helper) | 885 KB | whisper.cpp | Hugging Face | MIT |
| Parakeet TDT 0.6B v3 Q8_0 | 750 MB | Parakeet | QVAC registry | CC-BY-4.0 |
| Parakeet TDT 1.1B Q8_0 | 1.28 GB | Parakeet | QVAC registry | CC-BY-4.0 |
| MOSS Transcribe Diarize Q8_0 | 980 MB | MOSS | QVAC registry | Apache 2.0 |

## Text to speech · download only

| Option | Download | Files | License |
| --- | ---: | ---: | --- |
| Supertonic 3 Q8_0 | 127 MB | 1 | OpenRAIL-M |
| Supertonic 3 F16 | 207 MB | 1 | OpenRAIL-M |
| Chatterbox Turbo English Q8_0 | 1.32 GB | 2 | MIT |
| Chatterbox Multilingual Q8_0 | 1.43 GB | 2 | MIT |
| Parler-TTS Mini v1 Q8_0 | 1.16 GB | 1 | Apache 2.0 |
| Parler-TTS Large v1 Q8_0 | 2.77 GB | 1 | Apache 2.0 |
| Indic Parler-TTS Q8_0 | 1.29 GB | 1 | Apache 2.0 |

Every speech option is below 3.2 GB and leaves room for a writing model on a 24 GB Mac. Larger QVAC speech checkpoints (MOSS-TTS, MOSS-TTSD at ~19–21 GB, MOSS-Speech) and multi-directory CosyVoice3 are deliberately excluded. Chatterbox Multilingual needs an extra MeCab dictionary for Japanese, which is not downloaded.

QVAC's text-to-speech conversions, Parakeet and MOSS Transcribe are published only in the QVAC model registry, not on Hugging Face (community GGUFs such as CrispASR's use a different layout). These entries download through `@qvac/registry-client` over Hyperswarm peers using the blob coordinates pinned in `@qvac/inference` 0.22. No registry search or discovery runs; each file still has to match its pinned size and SHA-256 before it replaces a destination. Bundled models (Chatterbox) count as installed only when every file verifies, and already-verified files are reused on retry. The peer block cache (`registry-cache` beside `models`) is deleted after each transfer, so disk use during a download peaks at about the model size plus its largest file. Whisper and Silero VAD download over pinned HTTPS like the writing models.

This change only manages speech downloads and verification. It does not load the models, add the ASR/TTS plugins to the runtime configuration or enable transcription or read-aloud UI.

## Lightweight writing and image downloads

| Option | Download bytes | Suggested system memory | Publisher license |
| --- | ---: | --- | --- |
| Qwen2.5 0.5B Instruct Q4_K_M | 491,400,032 (~491 MB) | 4 GB+ | Apache 2.0 |
| Qwen2.5 1.5B Instruct Q4_K_M | 1,117,320,736 (~1.12 GB) | 8 GB+ | Apache 2.0 |
| Qwen2.5 3B Instruct Q4_K_M | 2,104,932,768 (~2.10 GB) | 8 GB+ | Qwen Research, non-commercial |
| Gemma 3 1B Instruct Q4_K_M | 806,058,240 (~806 MB) | 8 GB+ | Gemma Terms of Use |
| Gemma 3 4B Instruct Q4_K_M | 2,489,757,856 (~2.49 GB) | 8 GB+ | Gemma Terms of Use |
| Stable Diffusion 2.1 Q8_0 | 2,322,705,024 (~2.32 GB) | 8 GB+ | CreativeML Open RAIL++-M |
| SDXL 1.0 Q4_0 | 3,940,010,720 (~3.94 GB) | 16 GB+ | CreativeML Open RAIL++-M |

All options require the existing Apple Silicon/macOS 14+ runtime. Larger models consume more resources; output quality and speed depend on the request and Mac. Models with multimodal capabilities are used for text only; this app does not download vision projectors or enable image/audio input. Writing, summary and presentation input/output limits remain unchanged.

Only one writing model is loaded at a time. Switching unloads the previous worker, preserves other owned downloads and remembers the new active model and writing assignment. Accepted phone work blocks writing model changes until it finishes or is cancelled. Image downloads run separately: they never unload the writing worker, change the assignment or alter phone readiness, and phone writing can continue during the transfer. External writing files are checked against the selected model and never deleted. A previous external file can be selected again from disk.

The image entries are all-in-one GGUF artifacts from QVAC's registry, including their text encoders and VAE. They can be downloaded now for future image-generation support on desktop and phones. This change only manages their download and verification; it does not load them, enable a generation UI, select a diffusion plugin or impose a phone-specific image restriction.

Every load checks the complete file size and SHA-256. Downloads require the selected file's size plus 100 MiB free space, use pinned revisions, discard partial files on interruption/cancellation, and replace a destination only after integrity verification. No model is downloaded automatically at startup or when browsing the dropdown.

Publisher metadata was checked on 2026-10-27:

- [0.5B pinned files](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/tree/9217f5db79a29953eb74d5343926648285ec7e67)
- [1.5B pinned files](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/tree/91cad51170dc346986eccefdc2dd33a9da36ead9)
- [3B pinned files and research license](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/tree/7dabda4d13d513e3e842b20f0d435c732f172cbe)
- [Gemma 3 1B GGUF conversion](https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/tree/f9c28bcd85737ffc5aef028638d3341d49869c27)
- [Gemma 3 4B GGUF conversion](https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/tree/d0976223747697cb51e056d85c532013931fe52e)
- [Stable Diffusion 2.1 GGUF conversion](https://huggingface.co/gpustack/stable-diffusion-v2-1-GGUF/tree/ef8fa11863cc80ab078276f9a0bf81601e5ed904)
- [SDXL 1.0 GGUF conversion](https://huggingface.co/gpustack/stable-diffusion-xl-base-1.0-GGUF/tree/f00927e80a399ecb0bcacca868131d5e9d4e77aa)
- [Llama 3.2 3B GGUF](https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/tree/5ab33fa94d1d04e903623ae72c95d1696f09f9e8)
- [Llama 3.1 8B GGUF](https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/tree/bf5b95e96dac0462e2a09145ec66cae9a3f12067)
- [Mistral 7B GGUF](https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/tree/61fd4167fff3ab01ee1cfe0da183fa27a944db48)
- [Mistral NeMo 12B GGUF](https://huggingface.co/bartowski/Mistral-Nemo-Instruct-2407-GGUF/tree/a2dd64a0a76ea1bdb2bb6ab6fa5496b003c7c908)
- [Phi-4 mini GGUF](https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/tree/7ff82c2aaa4dde30121698a973765f39be5288c0)
- [Microsoft's Phi-4 GGUF](https://huggingface.co/microsoft/phi-4-gguf/tree/6edc2ef6664b739a8e11e62f2672ff6afe0c15ac)
- [Gemma 3 12B GGUF](https://huggingface.co/ggml-org/gemma-3-12b-it-GGUF/tree/ec0cbabd8dbff316f659876a50202295c3c4a314)
- [Qwen3 4B Instruct 2507 GGUF](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/tree/a06e946bb6b655725eafa393f4a9745d460374c9)
- [Gemma 4 E2B GGUF](https://huggingface.co/bartowski/google_gemma-4-E2B-it-GGUF/tree/81012ba3538e061d5ee003f11f25335b17f82e2d)
- [Gemma 4 E4B GGUF](https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF/tree/029e94146666900b08caf49a3b47b413dfa8ec66)
- [Qwen3.5 4B GGUF](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/tree/e87f176479d0855a907a41277aca2f8ee7a09523)
- [Qwen3.5 9B GGUF](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/tree/3885219b6810b007914f3a7950a8d1b469d598a5)
- [Liquid AI LFM2.5 1.2B GGUF](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/tree/8ed288026e23958ad9dfa92d53ed773a8eee7125)
- [Liquid AI LFM2.5 2.6B GGUF](https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/tree/e7caca5d835a3901a8e0d63e94009429bafafdfc)
- [SmolLM3 3B GGUF](https://huggingface.co/unsloth/SmolLM3-3B-GGUF/tree/a7bc17204c8a326d6bd6e466e076959eddae2025)
- [Qwen2.5-Coder 7B GGUF](https://huggingface.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF/tree/1f629da0c8bed16b9e50cee91c70693650e66c35)
- [Qwen2.5-Coder 14B GGUF](https://huggingface.co/bartowski/Qwen2.5-Coder-14B-Instruct-GGUF/tree/5b379ec4bf71bafecb5f9081ad28b19939128988)
- [gpt-oss 20B GGUF](https://huggingface.co/ggml-org/gpt-oss-20b-GGUF/tree/15dcfc7e7c608c6161507211ed43c5b590801b4b)
- [Qwen3-Coder 30B A3B GGUF](https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/tree/b17cb02dd882d5b6ab62fc777ad2995f19668350)

Heavy additions verified 2026-10-29:

- [Qwen3-14B-GGUF pinned files](https://huggingface.co/unsloth/Qwen3-14B-GGUF/tree/a04a82c4739b3ef5fa6da7d10261db2c67dd1985)
- [Qwen3-32B-GGUF pinned files](https://huggingface.co/unsloth/Qwen3-32B-GGUF/tree/931c84066f88693a02ab8de820cfcd066d913241)
- [Qwen3-30B-A3B-Instruct-2507-GGUF pinned files](https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF/tree/eea7b2be5805a5f151f8847ede8e5f9a9284bf77)
- [Qwen3.5-27B-GGUF pinned files](https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/tree/3221f178a6b842d04f1fb42f1c413534adcc0a6a)
- [Qwen3.5-35B-A3B-GGUF pinned files](https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/tree/bc014a17be43adabd7066b7a86075ff935c6a4e2)
- [gemma-3-27b-it-GGUF pinned files](https://huggingface.co/ggml-org/gemma-3-27b-it-GGUF/tree/f94c25afed0072339c5fa3b705a7b4222afe5f62)
- [mistralai_Mistral-Small-3.2-24B-Instruct-2506-GGUF pinned files](https://huggingface.co/bartowski/mistralai_Mistral-Small-3.2-24B-Instruct-2506-GGUF/tree/b3592d09be469bedab6be51f577824b3b6b76ba1)

The exact revisions, sizes and publisher LFS checksums are in `src/model.cjs`, `src/writing-models.cjs` and `src/speech-models.cjs`. A test checks every registry speech pin (path, size, checksum, blob coordinates and engine) against the installed `@qvac/inference` registry. Every added file was matched to metadata from its pinned publisher/converter repository. The newer architecture names (`qwen35`, `gemma4`, `lfm2`, `smollm3`) and established families were found in the installed native runtime; Qwen3.5 and Gemma 4 also appear in the installed QVAC model registry. This establishes available architecture support, not model-specific inference verification. The two diffusion checksums match QVAC 0.22 registry entries. Runtime and worker configuration continue to select only the writing plugin.

Tests use small synthetic files and runtime adapters to cover catalog bounds, selection migration, download integrity/access/cancellation, installed inventory, backend and direct-answer settings, writing assignment persistence, continued phone writing during image downloads, accepted-work fences and removal. They do not establish native inference quality or hardware fit for individual models. No model weights were downloaded for this change; downloading and testing them is left to the user.
