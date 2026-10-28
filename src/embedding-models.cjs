// S03b text embeddings for phone recall. Qwen's official GGUF conversions,
// pinned to a Hugging Face revision with LFS SHA-256 (checked 2026-10-28).
// Both produce 1024-dimension vectors; the phone's vector index is built for
// that size, so a model with another dimension cannot be added here alone.
// Vectors from the two quantizations differ, so switching rebuilds the index.
const QWEN3_EMBEDDING = { capability: 'embedding', engine: 'llamacpp-embedding', dimensions: 1024, origin: 'Qwen / Hugging Face',
  repository: 'Qwen/Qwen3-Embedding-0.6B-GGUF', revision: '370f27d7550e0def9b39c1f16d3fbaa13aa67728', license: 'Apache 2.0',
  // Qwen3-Embedding marks queries with a one-line task instruction; documents are embedded as written.
  queryInstruction: 'Given a question or search words, retrieve personal journal entries, notes or thoughts that answer or relate to it' };

module.exports = Object.freeze([{
  ...QWEN3_EMBEDDING, id: 'qwen3-embedding-0.6b-q8_0@370f27d7550e0def9b39c1f16d3fbaa13aa67728',
  name: 'Qwen3 Embedding · 0.6B', quantization: 'Q8_0', tier: 'Recommended recall',
  description: 'Multilingual text embeddings for finding diary entries, notes and thoughts by meaning. Strong on English and over 100 other languages.',
  memoryGB: 4, fitHint: 'Small enough to stay loaded beside a writing model and Whisper on a 24 GB Mac.',
  filename: 'Qwen3-Embedding-0.6B-Q8_0.gguf', bytes: 639150592,
  sha256: '06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439',
}, {
  ...QWEN3_EMBEDDING, id: 'qwen3-embedding-0.6b-f16@370f27d7550e0def9b39c1f16d3fbaa13aa67728',
  name: 'Qwen3 Embedding · 0.6B (full precision)', quantization: 'F16', tier: 'Full-precision recall',
  description: 'The same embedding model without quantization. Marginally more precise; switching to it re-indexes every phone.',
  memoryGB: 4, fitHint: 'About 1.2 GB; comfortable on a 24 GB Mac.',
  filename: 'Qwen3-Embedding-0.6B-f16.gguf', bytes: 1197629632,
  sha256: '421a27e58d165478cc7acb984a688c2aa41404968b0203e7cd743ece44c54340',
}]);
