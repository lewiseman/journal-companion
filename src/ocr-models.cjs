// I04 printed-text OCR: QVAC's EasyOCR GGUF conversions (CRAFT detector +
// Latin CRNN recognizer for the ocr-ggml engine). Published only in the QVAC
// registry, so they use pinned blob coordinates and SHA-256 from
// @qvac/inference 0.22's OCR_LATIN and OCR_CRAFT entries (checked 2026-10-28).
module.exports = Object.freeze([{
  source: 'registry', revision: 'qvac-registry',
  id: 'easyocr-latin-g2-craft@qvac-registry', capability: 'ocr', engine: 'ggml-ocr', quantization: 'F16',
  name: 'EasyOCR · Latin', tier: 'Printed text scanning',
  description: 'Finds and reads printed Latin-script text line by line with a confidence for each line. Not trained for handwriting.',
  memoryGB: 4, origin: 'JaidedAI EasyOCR / QVAC registry', license: 'Apache 2.0', detailsUrl: 'https://huggingface.co/qvac',
  filename: 'latin_g2.gguf', bytes: 15396512 + 83133856,
  sha256: 'dd1c7a436e9175904e63683e939635892f45c8c6377d5e14e87cf8b175e10768',
  parts: [
    { filename: 'latin_g2.gguf', bytes: 15396512, sha256: 'dd1c7a436e9175904e63683e939635892f45c8c6377d5e14e87cf8b175e10768',
      registryPath: 'qvac_models_compiled/ocr/gguf/easyocr/2026-05-14/latin_g2.gguf',
      blob: { coreKey: 'd90c0263033385abdb2290a69936d5cef030d5c63c87baa33c3a4a2d01b84ca8', blockOffset: 2109431, blockLength: 235, byteOffset: 138237213166 } },
    { filename: 'craft_mlt_25k.gguf', bytes: 83133856, sha256: '74501993caf4581ce09b280f49a1b3d249c0f5a78496e047718b398457a875aa',
      registryPath: 'qvac_models_compiled/ocr/gguf/easyocr/2026-05-14/craft_mlt_25k.gguf',
      blob: { coreKey: 'd90c0263033385abdb2290a69936d5cef030d5c63c87baa33c3a4a2d01b84ca8', blockOffset: 2108162, blockLength: 1269, byteOffset: 138154079310 } },
  ],
}]);
