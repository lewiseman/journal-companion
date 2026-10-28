// I03 image understanding. Qwen's own GGUF conversion at a pinned revision;
// both files are size- and SHA-256-checked (hashes match @qvac/inference 0.22's
// QWEN3VL_2B_MULTIMODAL_Q4_K and MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K entries).
// The projection file is what lets llama.cpp accept image attachments.
module.exports = Object.freeze([{
  id: 'qwen3-vl-2b-instruct-q4_k_m@52d6c8ffea26cc873ac5ad116f8631268d7eb503',
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
}]);
