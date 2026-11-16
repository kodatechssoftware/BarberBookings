import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";

export const CERTIFICATE_INPUT_MAX_BYTES = 10 * 1024 * 1024;
export const CERTIFICATE_OUTPUT_MAX_BYTES = 3 * 1024 * 1024;
export const CERTIFICATE_MAX_EDGE_PIXELS = 2400;
export const CERTIFICATE_MAX_INPUT_PIXELS = 40_000_000;
export const CERTIFICATE_ALLOWED_INPUT_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export class CertificateImageError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

export type ProcessedCertificateImage = {
  bytes: Buffer;
  mimeType: "image/webp";
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
};

export async function processCertificateImage(input: Buffer, declaredMimeType: string): Promise<ProcessedCertificateImage> {
  if (!CERTIFICATE_ALLOWED_INPUT_MIME.has(declaredMimeType.toLowerCase())) {
    throw new CertificateImageError("CERTIFICATE_MIME_NOT_ALLOWED", 415, "Utilize uma imagem JPG, PNG ou WebP.");
  }
  if (input.length === 0 || input.length > CERTIFICATE_INPUT_MAX_BYTES) {
    throw new CertificateImageError("CERTIFICATE_INPUT_SIZE_INVALID", 413, "A imagem deve ter no máximo 10 MB.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input, { failOn: "warning", limitInputPixels: CERTIFICATE_MAX_INPUT_PIXELS, animated: false }).metadata();
  } catch {
    throw new CertificateImageError("CERTIFICATE_IMAGE_INVALID", 400, "O ficheiro não contém uma imagem válida ou está danificado.");
  }
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new CertificateImageError("CERTIFICATE_CONTENT_NOT_ALLOWED", 415, "O conteúdo do ficheiro não corresponde a JPG, PNG ou WebP.");
  }
  const expectedFormat = declaredMimeType.toLowerCase() === "image/jpeg"
    ? "jpeg"
    : declaredMimeType.toLowerCase().slice("image/".length);
  if (metadata.format !== expectedFormat) {
    throw new CertificateImageError("CERTIFICATE_MIME_MISMATCH", 415, "O tipo declarado não corresponde ao conteúdo real da imagem.");
  }
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
    throw new CertificateImageError("CERTIFICATE_IMAGE_INVALID", 400, "A imagem não pode ser animada e deve ter dimensões válidas.");
  }

  const attempts = [
    { edge: CERTIFICATE_MAX_EDGE_PIXELS, quality: 86 },
    { edge: 2100, quality: 80 },
    { edge: 1800, quality: 74 },
  ];
  for (const attempt of attempts) {
    try {
      const { data, info } = await sharp(input, {
        failOn: "warning",
        limitInputPixels: CERTIFICATE_MAX_INPUT_PIXELS,
        animated: false,
      })
        .rotate()
        .resize({ width: attempt.edge, height: attempt.edge, fit: "inside", withoutEnlargement: true })
        .webp({ quality: attempt.quality, effort: 5 })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= CERTIFICATE_OUTPUT_MAX_BYTES) {
        return {
          bytes: data,
          mimeType: "image/webp",
          byteSize: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          width: info.width,
          height: info.height,
        };
      }
    } catch {
      throw new CertificateImageError("CERTIFICATE_IMAGE_INVALID", 400, "Não foi possível processar esta imagem.");
    }
  }
  throw new CertificateImageError("CERTIFICATE_OUTPUT_TOO_LARGE", 413, "A imagem continua demasiado grande depois da otimização.");
}
