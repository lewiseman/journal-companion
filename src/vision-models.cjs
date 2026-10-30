// I03 image understanding. QVAC's own VisionPsy-Nano GGUF conversion at a pinned
// revision; both files are size- and SHA-256-checked (hashes match @qvac/inference
// 0.22's VISIONPSY_NANO_460M_MULTIMODAL_Q4_K_M_1 and MMPROJ_..._Q8_0_1 entries).
// The projection file is what lets llama.cpp accept image attachments.
// Not the Flash variant: its model card requires QVAC's patched llama.cpp.
const VISIONPSY_NANO = {
  recommended: true, id: 'visionpsy-nano-460m-q4_k_m@4138c5bd6e026d67cebf2dbd2d81c6229c14cdc1',
  name: 'VisionPsy-Nano · 460M', capability: 'vision', engine: 'llamacpp-completion', quantization: 'Q4_K_M',
  tier: 'Image understanding',
  description: 'QVAC\'s small vision-language model for describing and answering questions about one note image. Loaded only while a request runs.',
  memoryGB: 4, fitHint: 'Small enough to run alongside any writing model; loads for each image request.',
  origin: 'QVAC / Hugging Face', repository: 'qvac/VisionPsy-Nano-460M-GGUFs', revision: '4138c5bd6e026d67cebf2dbd2d81c6229c14cdc1',
  license: 'Apache 2.0', filename: 'visionpsy-nano-460m-q4_k_m-imat.gguf', bytes: 303143488 + 108782144,
  sha256: '41794b9f501e30f44f19c8be4b87b965db77fbd3e4c7625291999cff7966db8a',
  parts: [
    { filename: 'visionpsy-nano-460m-q4_k_m-imat.gguf', bytes: 303143488, sha256: '41794b9f501e30f44f19c8be4b87b965db77fbd3e4c7625291999cff7966db8a' },
    { filename: 'mmproj-visionpsy-nano-460m-q8.gguf', bytes: 108782144, sha256: '92f1bb80acaba3e7b59b6534f47447b830330bc9051018d6d8b5d768e58503c2', quantization: 'Q8_0' },
  ],
};

// Previous pick, kept for switching back: Qwen's own conversion, hashes match
// QWEN3VL_2B_MULTIMODAL_Q4_K and MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K. Stronger at
// reading scanned pages; four times the download.
const QWEN3_VL_2B = {
  recommended: true, id: 'qwen3-vl-2b-instruct-q4_k_m@52d6c8ffea26cc873ac5ad116f8631268d7eb503',
  name: 'Qwen3-VL · 2B Instruct', capability: 'vision', engine: 'llamacpp-completion', quantization: 'Q4_K_M',
  tier: 'Image understanding',
  description: 'A compact vision-language model for describing and answering questions about one note image. Loaded only while a request runs.',
  memoryGB: 8, fitHint: 'Runs alongside a writing model on a 24 GB Mac; loads for each image request.',
  origin: 'Qwen / Hugging Face', repository: 'Qwen/Qwen3-VL-2B-Instruct-GGUF', revision: '52d6c8ffea26cc873ac5ad116f8631268d7eb503',
  license: 'Apache 2.0', filename: 'Qwen3VL-2B-Instruct-Q4_K_M.gguf', bytes: 1107409952 + 445053216,
  sha256: '089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae',
  parts: [
    { filename: 'Qwen3VL-2B-Instruct-Q4_K_M.gguf', bytes: 1107409952, sha256: '089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae' },
    { filename: 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf', bytes: 445053216, sha256: 'f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82', quantization: 'Q8_0' },
  ],
};

// The vision engine uses the one entry exported here; swap in QWEN3_VL_2B to go back.
module.exports = Object.freeze([VISIONPSY_NANO]);
