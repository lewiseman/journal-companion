// Download-only speech models selected for a 24 GB Apple Silicon Mac.
// Whisper files come from pinned Hugging Face revisions over HTTPS. QVAC's
// Parakeet, MOSS and tts-ggml conversions are published only in the QVAC
// registry, so those use `source: 'registry'` with the blob coordinates and
// SHA-256 pinned in @qvac/inference 0.22 (checked 2026-10-28; see docs/MODELS.md).
const WHISPER = { capability: 'transcription', engine: 'whispercpp-transcription', origin: 'OpenAI / ggml-org / Hugging Face',
  repository: 'ggerganov/whisper.cpp', revision: '5359861c739e955e79d9a303bcbc70fb988958b1', license: 'MIT' };
const REGISTRY = { source: 'registry', revision: 'qvac-registry' };

module.exports = Object.freeze([{
  ...WHISPER, recommended: true, id: 'whisper-large-v3-turbo@5359861c739e955e79d9a303bcbc70fb988958b1',
  name: 'Whisper · Large v3 Turbo', quantization: 'F16', tier: 'Recommended transcription',
  description: 'OpenAI’s fast large Whisper for about 99 languages and translation to English. The accuracy and speed sweet spot on Apple Silicon.',
  memoryGB: 8, fitHint: 'Comfortable on a 24 GB Mac alongside a writing model.',
  filename: 'ggml-large-v3-turbo.bin', bytes: 1624555275,
  sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
}, {
  ...WHISPER, id: 'whisper-large-v3-turbo-q8_0@5359861c739e955e79d9a303bcbc70fb988958b1',
  name: 'Whisper · Large v3 Turbo (compact)', quantization: 'Q8_0', tier: 'Smaller turbo transcription',
  description: 'The same Large v3 Turbo model at 8-bit for roughly half the download with near-identical transcripts.',
  memoryGB: 8, fitHint: 'Leaves plenty of room for other apps on a 24 GB Mac.',
  filename: 'ggml-large-v3-turbo-q8_0.bin', bytes: 874188075,
  sha256: '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1',
}, {
  ...WHISPER, id: 'whisper-large-v3@5359861c739e955e79d9a303bcbc70fb988958b1',
  name: 'Whisper · Large v3', quantization: 'F16', tier: 'Highest-accuracy Whisper',
  description: 'The full Large v3 decoder for difficult audio and accents. Slower than Turbo.',
  memoryGB: 16, fitHint: 'Fits a 24 GB Mac; expect slower transcription than Turbo.',
  filename: 'ggml-large-v3.bin', bytes: 3095033483,
  sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2',
}, {
  ...WHISPER, id: 'whisper-medium-q8_0@5359861c739e955e79d9a303bcbc70fb988958b1',
  name: 'Whisper · Medium', quantization: 'Q8_0', tier: 'Balanced transcription',
  description: 'A multilingual middle size between Small and Large for everyday dictation.',
  memoryGB: 8, filename: 'ggml-medium-q8_0.bin', bytes: 823369779,
  sha256: '42a1ffcbe4167d224232443396968db4d02d4e8e87e213d3ee2e03095dea6502',
}, {
  ...WHISPER, id: 'whisper-small-q8_0@5359861c739e955e79d9a303bcbc70fb988958b1',
  name: 'Whisper · Small', quantization: 'Q8_0', tier: 'Compact transcription',
  description: 'A small multilingual Whisper for quick notes and short voice memos.',
  memoryGB: 4, filename: 'ggml-small-q8_0.bin', bytes: 264464607,
  sha256: '49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f',
}, {
  ...WHISPER, id: 'whisper-base.en-q8_0@5359861c739e955e79d9a303bcbc70fb988958b1',
  name: 'Whisper · Base (English)', quantization: 'Q8_0', tier: 'Lightweight English',
  description: 'A tiny English-only Whisper for fast drafts when size matters most.',
  memoryGB: 4, filename: 'ggml-base.en-q8_0.bin', bytes: 81781811,
  sha256: 'a4d4a0768075e13cfd7e19df3ae2dbc4a68d37d36a7dad45e8410c9a34f8c87e',
}, {
  ...WHISPER, id: 'silero-vad-5.1.2@9ffd54a1e1ee413ddf265af9913beaf518d1639b',
  name: 'Silero VAD · v5.1.2', quantization: 'F32', tier: 'Live-capture helper', origin: 'Silero / ggml-org / Hugging Face',
  description: 'Voice activity detection that Whisper uses to split live recordings. Download alongside a Whisper model for live capture.',
  memoryGB: 4, repository: 'ggml-org/whisper-vad', revision: '9ffd54a1e1ee413ddf265af9913beaf518d1639b',
  filename: 'ggml-silero-v5.1.2.bin', bytes: 885098,
  sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf',
}, {
  ...REGISTRY, id: 'parakeet-tdt-0.6b-v3-q8_0@qvac-registry', capability: 'transcription', engine: 'parakeet-transcription',
  name: 'Parakeet TDT · 0.6B v3', quantization: 'Q8_0', tier: 'Fast multilingual transcription',
  description: 'NVIDIA’s streaming-capable recognizer for about 25 languages with punctuation and language detection. QVAC’s recommended default.',
  memoryGB: 4, origin: 'NVIDIA / QVAC registry', license: 'CC-BY-4.0', detailsUrl: 'https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3',
  parts: [
    { filename: 'parakeet-tdt-0.6b-v3.q8_0.gguf', bytes: 749625152, sha256: 'fe3013294baaa39e77615d39ec75c627496c60b95e72b1097674db64eebf9aaf',
      registryPath: 'qvac_models_compiled/ggml/parakeet/2026-09-30/parakeet-tdt-0.6b-v3.q8_0.gguf',
      blob: { coreKey: 'dcfc2187d23e3a82212144211b94d1bd2f521cc21e18ca66bea8a1f7749bc7a1', blockOffset: 594916, blockLength: 11439, byteOffset: 38984809636 } },
  ],
}, {
  ...REGISTRY, id: 'parakeet-tdt-1.1b-q8_0@qvac-registry', capability: 'transcription', engine: 'parakeet-transcription',
  name: 'Parakeet TDT · 1.1B', quantization: 'Q8_0', tier: 'Larger English transcription',
  description: 'A larger NVIDIA English recognizer for higher accuracy on long recordings.',
  memoryGB: 8, origin: 'NVIDIA / QVAC registry', license: 'CC-BY-4.0', detailsUrl: 'https://huggingface.co/nvidia/parakeet-tdt-1.1b',
  parts: [
    { filename: 'parakeet-tdt-1.1b.q8_0.gguf', bytes: 1284062944, sha256: '91a4028ee0795526154185eb46edf2e63b06674f279fb6e3987a2a82e0c9edb7',
      registryPath: 'qvac_models_compiled/ggml/parakeet/2026-09-30/parakeet-tdt-1.1b.q8_0.gguf',
      blob: { coreKey: 'dcfc2187d23e3a82212144211b94d1bd2f521cc21e18ca66bea8a1f7749bc7a1', blockOffset: 677869, blockLength: 19594, byteOffset: 44420832644 } },
  ],
}, {
  ...REGISTRY, id: 'moss-transcribe-diarize-q8_0@qvac-registry', capability: 'transcription', engine: 'moss-transcribe',
  name: 'MOSS Transcribe · Diarize', quantization: 'Q8_0', tier: 'Transcripts with speakers',
  description: 'One-pass transcripts with speaker labels and timestamps for whole recordings, strongest in Spanish and Chinese.',
  memoryGB: 8, origin: 'OpenMOSS / QVAC registry', license: 'Apache 2.0', detailsUrl: 'https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize',
  parts: [
    { filename: 'moss-transcribe-diarize-q8_0.gguf', bytes: 980100416, sha256: 'c55e9e912a5e934f7fb9dc74e0d8b0e495c5fe6737bcffe0f325759417c4432c',
      registryPath: 'qvac_models_compiled/ggml/openmoss/2026-10-01/moss-transcribe-diarize-q8_0.gguf',
      blob: { coreKey: 'dcfc2187d23e3a82212144211b94d1bd2f521cc21e18ca66bea8a1f7749bc7a1', blockOffset: 1450947, blockLength: 14956, byteOffset: 95084164398 } },
  ],
}, {
  ...REGISTRY, id: 'supertonic3-q8_0@qvac-registry', capability: 'speech', engine: 'tts-ggml',
  name: 'Supertonic 3', quantization: 'Q8_0', tier: 'Fast multilingual voice',
  description: 'A very fast read-aloud voice for 31 languages with ten built-in voices. A small, quick first choice.',
  memoryGB: 4, origin: 'Supertone / QVAC registry', license: 'OpenRAIL-M', detailsUrl: 'https://huggingface.co/Supertone/supertonic-3',
  parts: [
    { filename: 'supertonic3-q8_0.gguf', bytes: 126745792, sha256: '139ba4f76ff1c703cd072030b4e28fa009593162dc686aa2b3ce588991179899',
      registryPath: 'qvac_models_compiled/ggml/supertonic/2026-06-15/supertonic3-q8_0.gguf',
      blob: { coreKey: 'd90c0263033385abdb2290a69936d5cef030d5c63c87baa33c3a4a2d01b84ca8', blockOffset: 2093835, blockLength: 1934, byteOffset: 137215284814 } },
  ],
}, {
  ...REGISTRY, id: 'supertonic3-f16@qvac-registry', capability: 'speech', engine: 'tts-ggml',
  name: 'Supertonic 3 (full precision)', quantization: 'F16', tier: 'Higher-fidelity Supertonic',
  description: 'Supertonic 3 at 16-bit for slightly cleaner audio. Still small and fast.',
  memoryGB: 4, origin: 'Supertone / QVAC registry', license: 'OpenRAIL-M', detailsUrl: 'https://huggingface.co/Supertone/supertonic-3',
  parts: [
    { filename: 'supertonic3-f16.gguf', bytes: 206631232, sha256: '0947ef62dc9928489315ec47488b3d0f32b7e8fa47c556a9155f72c966cd73dc',
      registryPath: 'qvac_models_compiled/ggml/supertonic/2026-06-10/supertonic3-f16.gguf',
      blob: { coreKey: '6309722b3460d91d38ad7526875ecfa29183245826b717949c55ba443093d963', blockOffset: 3694076, blockLength: 3153, byteOffset: 242083189834 } },
  ],
}, {
  ...REGISTRY, id: 'chatterbox-turbo-en-q8_0@qvac-registry', capability: 'speech', engine: 'tts-ggml',
  name: 'Chatterbox Turbo · English', quantization: 'Q8_0', tier: 'Natural English with voice cloning',
  description: 'Expressive English speech that can match a short reference recording, with low first-audio latency. Two files: T3 Turbo and S3Gen.',
  memoryGB: 8, origin: 'Resemble AI / QVAC registry', license: 'MIT', detailsUrl: 'https://huggingface.co/ResembleAI/chatterbox-turbo',
  parts: [
    { filename: 'chatterbox-t3-turbo-q8_0.gguf', bytes: 487091392, sha256: 'bcbfad4019e582a78df01d624f67ef8abc5399625935169b4cd620ea4a82074d',
      registryPath: 'qvac_models_compiled/ggml/chatterbox/2026-05-18/chatterbox-t3-turbo-q8_0.gguf',
      blob: { coreKey: 'd90c0263033385abdb2290a69936d5cef030d5c63c87baa33c3a4a2d01b84ca8', blockOffset: 1118213, blockLength: 7433, byteOffset: 73278211834 } },
    { filename: 'chatterbox-s3gen-q8_0.gguf', bytes: 829702464, sha256: '09038488320deb4091c895c8f589cbd6708ca7d445ba78fb2b5eefb14301073b',
      registryPath: 'qvac_models_compiled/ggml/chatterbox/2026-06-01/chatterbox-s3gen-q8_0.gguf',
      blob: { coreKey: 'd90c0263033385abdb2290a69936d5cef030d5c63c87baa33c3a4a2d01b84ca8', blockOffset: 1667854, blockLength: 12661, byteOffset: 109298746705 } },
  ],
}, {
  ...REGISTRY, id: 'chatterbox-multilingual-q8_0@qvac-registry', capability: 'speech', engine: 'tts-ggml',
  name: 'Chatterbox · Multilingual', quantization: 'Q8_0', tier: 'Multilingual voice cloning',
  description: 'Chatterbox for European and East Asian languages with the same voice-matching. Two files: T3 and S3Gen. Japanese also needs a dictionary that is not included.',
  memoryGB: 8, origin: 'Resemble AI / QVAC registry', license: 'MIT', detailsUrl: 'https://huggingface.co/ResembleAI/chatterbox',
  parts: [
    { filename: 'chatterbox-t3-mtl-q8_0.gguf', bytes: 604323648, sha256: 'c8f992786650b6e5cfc7c41a75bf8e6eb5539e524d0f7bb205c8448fd2ce7380',
      registryPath: 'qvac_models_compiled/ggml/chatterbox/2026-05-18/chatterbox-t3-mtl-q8_0.gguf',
      blob: { coreKey: 'd90c0263033385abdb2290a69936d5cef030d5c63c87baa33c3a4a2d01b84ca8', blockOffset: 1103915, blockLength: 9222, byteOffset: 72341283066 } },
    { filename: 'chatterbox-s3gen-mtl-q8_0.gguf', bytes: 827414304, sha256: '894f342725c253cbaf556bbb17ff6a7c71d8590bfa4dbd3dfca9e569b5182e33',
      registryPath: 'qvac_models_compiled/ggml/chatterbox/2026-06-01/chatterbox-s3gen-mtl-q8_0.gguf',
      blob: { coreKey: 'd90c0263033385abdb2290a69936d5cef030d5c63c87baa33c3a4a2d01b84ca8', blockOffset: 1704726, blockLength: 12626, byteOffset: 111715059921 } },
  ],
}, {
  ...REGISTRY, id: 'parler-mini-v1-q8_0@qvac-registry', capability: 'speech', engine: 'tts-ggml',
  name: 'Parler-TTS · Mini v1', quantization: 'Q8_0', tier: 'Described English voice',
  description: 'English speech shaped by a written description of the voice, pace and emotion.',
  memoryGB: 8, origin: 'Hugging Face Parler-TTS / QVAC registry', license: 'Apache 2.0', detailsUrl: 'https://huggingface.co/parler-tts/parler-tts-mini-v1',
  parts: [
    { filename: 'parler-mini-v1-q8_0.gguf', bytes: 1162597856, sha256: 'b8a72142b73e540b8aa801519ce47bc235439330d6f2d41bf0e37ba059b3160f',
      registryPath: 'qvac_models_compiled/ggml/parler-tts/2026-07-20/parler-mini-v1-q8_0.gguf',
      blob: { coreKey: '6309722b3460d91d38ad7526875ecfa29183245826b717949c55ba443093d963', blockOffset: 4448185, blockLength: 17740, byteOffset: 291504077898 } },
  ],
}, {
  ...REGISTRY, id: 'parler-large-v1-q8_0@qvac-registry', capability: 'speech', engine: 'tts-ggml',
  name: 'Parler-TTS · Large v1', quantization: 'Q8_0', tier: 'Larger described English voice',
  description: 'The 2.3B Parler-TTS for richer described voices. Slower than Mini.',
  memoryGB: 16, origin: 'Hugging Face Parler-TTS / QVAC registry', license: 'Apache 2.0', detailsUrl: 'https://huggingface.co/parler-tts/parler-tts-large-v1',
  parts: [
    { filename: 'parler-large-v1-q8_0.gguf', bytes: 2770947648, sha256: 'ab71ac8744da28d93063446c5c834e48f6fd8ead2369f92527d038e6de470360',
      registryPath: 'qvac_models_compiled/ggml/parler-tts/2026-07-20/parler-large-v1-q8_0.gguf',
      blob: { coreKey: '4035e66388340ff7c1f291e7c0101855f5d0b2c7085f3ff62213573a2cd5dd17', blockOffset: 2622993, blockLength: 42282, byteOffset: 171883892770 } },
  ],
}, {
  ...REGISTRY, id: 'parler-indic-q8_0@qvac-registry', capability: 'speech', engine: 'tts-ggml',
  name: 'Indic Parler-TTS', quantization: 'Q8_0', tier: 'Indic languages',
  description: 'Described speech for 21 Indic languages and English, with voice and emotion templates.',
  memoryGB: 8, origin: 'AI4Bharat / QVAC registry', license: 'Apache 2.0', detailsUrl: 'https://huggingface.co/ai4bharat/indic-parler-tts',
  parts: [
    { filename: 'parler-indic-q8_0.gguf', bytes: 1287330656, sha256: '3754448c805085b3d096f6c3070d9e9684d63b0c34adc5e81bb6acfe0bc16644',
      registryPath: 'qvac_models_compiled/ggml/parler-tts/2026-07-20/parler-indic-q8_0.gguf',
      blob: { coreKey: '4035e66388340ff7c1f291e7c0101855f5d0b2c7085f3ff62213573a2cd5dd17', blockOffset: 2352583, blockLength: 19644, byteOffset: 154162424898 } },
  ],
}].map((model) => Object.freeze(model.parts
  ? { ...model, bytes: model.parts.reduce((sum, part) => sum + part.bytes, 0), parts: Object.freeze(model.parts.map(Object.freeze)) }
  : model)));
