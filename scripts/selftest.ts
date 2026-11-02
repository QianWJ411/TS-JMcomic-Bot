import assert from "node:assert";
import crypto from "node:crypto";
import sharp from "sharp";
import {
  descrambleRaw,
  parseRange,
  segmentCount,
  parseAlbumId,
  unscrambleImage,
} from "../src/comic/jm.js";

function bandBuffer(width: number, height: number, channels: number): Buffer {
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        data[(y * width + x) * channels + c] = y;
      }
    }
  }
  return data;
}

function scramble(data: Buffer, width: number, height: number, channels: number, num: number): Buffer {
  const out = Buffer.alloc(data.length);
  const move = Math.floor(height / num);
  const over = height % num;
  const rowBytes = width * channels;
  for (let i = 0; i < num; i++) {
    let bandHeight = move;
    const ySrc = height - move * (i + 1) - over;
    let yDst = move * i;
    if (i === 0) {
      bandHeight += over;
    } else {
      yDst += over;
    }
    data.copy(out, ySrc * rowBytes, yDst * rowBytes, (yDst + bandHeight) * rowBytes);
  }
  return out;
}

// 1. 条带还原：把还原后的图再打乱，验证能得到原始行号
{
  const width = 2;
  const height = 22;
  const channels = 3;
  const original = bandBuffer(width, height, channels);
  const shuffled = scramble(original, width, height, channels, 4);
  const restored = descrambleRaw(width, height, channels, shuffled, 4);
  assert.deepStrictEqual(restored, original, "descramble 应还原原始行序");
  console.log("[OK] 条带还原（含高度余数）");
}

// 2. 条带数
{
  assert.strictEqual(segmentCount("100", 200, "00001"), 0, "aid < scramble 不处理");
  assert.strictEqual(segmentCount("200000", 0, "00001"), 10, "268850 以下固定 10 段");
  const n1 = segmentCount("500000", 0, "00001");
  const digest = crypto.createHash("md5").update("50000000001").digest("hex");
  const expected = (parseInt(digest.slice(-1), 16) % 8) * 2 + 2;
  assert.strictEqual(n1, expected, "段数应等于 md5 末位公式");
  assert.ok(n1 >= 2 && n1 <= 20 && n1 % 2 === 0, "段数在 2-20 且为偶数");
  console.log("[OK] 条带数计算");
}

// 3. 编号与范围
{
  assert.strictEqual(parseAlbumId("422578"), "422578");
  assert.strictEqual(parseAlbumId("JM422578"), "422578");
  assert.strictEqual(parseAlbumId("https://18comic.vip/album/422578/"), "422578");
  const range = parseRange("3-5,9");
  assert.deepStrictEqual([...range].sort((a, b) => a - b), [3, 4, 5, 9]);
  console.log("[OK] 编号与范围解析");
}

// 4. 图片还原（sharp 解码 → 条带搬回 → JPEG）
{
  const width = 200;
  const height = 100;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const band = Math.floor(y / 10);
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      raw[offset] = band * 20;
      raw[offset + 1] = 255 - band * 20;
      raw[offset + 2] = 128;
    }
  }
  const png = await sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
  const result = await unscrambleImage(
    { photoId: "456", albumId: "123", sort: 1, title: "", scrambleId: 1, domain: "x", images: [] },
    "00001.png",
    png,
  );
  assert.ok(result, "图片应能解码");
  const meta = await sharp(result.buffer).metadata();
  assert.strictEqual(result.width, width);
  assert.strictEqual(result.height, height);
  assert.strictEqual(meta.width, width);
  assert.strictEqual(meta.height, height);
  console.log("[OK] 图片条带还原与 JPEG 输出");
}

console.log("SELFTEST OK");
