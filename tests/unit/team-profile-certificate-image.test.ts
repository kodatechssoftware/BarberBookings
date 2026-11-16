import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  CERTIFICATE_INPUT_MAX_BYTES,
  CertificateImageError,
  processCertificateImage,
} from "../../server/team-profile-certificate-image";

test("certificate image processing validates content, strips metadata and produces bounded WebP", async () => {
  const input = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: "#f2d6df" } })
    .jpeg({ quality: 92 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await processCertificateImage(input, "image/jpeg");
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok(Math.max(result.width, result.height) <= 2400);
  assert.equal(metadata.orientation, undefined, "orientation/EXIF metadata is stripped");
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.byteSize, result.bytes.length);

  await assert.rejects(
    processCertificateImage(input, "image/png"),
    (error: unknown) => error instanceof CertificateImageError && error.code === "CERTIFICATE_MIME_MISMATCH",
  );
  await assert.rejects(
    processCertificateImage(Buffer.from("<svg onload=alert(1)></svg>"), "image/png"),
    (error: unknown) => error instanceof CertificateImageError && error.code === "CERTIFICATE_IMAGE_INVALID",
  );
  await assert.rejects(
    processCertificateImage(input.subarray(0, 50), "image/jpeg"),
    (error: unknown) => error instanceof CertificateImageError,
  );
  await assert.rejects(
    processCertificateImage(Buffer.alloc(CERTIFICATE_INPUT_MAX_BYTES + 1), "image/jpeg"),
    (error: unknown) => error instanceof CertificateImageError && error.status === 413,
  );
  const decompressionBomb = await sharp({ create: { width: 6500, height: 6500, channels: 3, background: "#fff" } }).png().toBuffer();
  await assert.rejects(
    processCertificateImage(decompressionBomb, "image/png"),
    (error: unknown) => error instanceof CertificateImageError && error.code === "CERTIFICATE_IMAGE_INVALID",
  );
});
