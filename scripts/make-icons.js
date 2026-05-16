const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const rootDir = path.resolve(__dirname, "..");
const svgPath = path.join(rootDir, "assets", "app-icon.svg");
const pngPath = path.join(rootDir, "assets", "app-icon.png");
const icoPath = path.join(rootDir, "assets", "app-icon.ico");
const uiPngPath = path.join(rootDir, "ui", "assets", "app-icon.png");

function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, png]);
}

async function main() {
  await fs.mkdir(path.dirname(uiPngPath), { recursive: true });
  const png = await sharp(svgPath).resize(256, 256).png().toBuffer();
  await fs.writeFile(pngPath, png);
  await fs.writeFile(uiPngPath, png);
  await fs.writeFile(icoPath, pngToIco(png));
  console.log(`已生成 ${pngPath}`);
  console.log(`已生成 ${icoPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
