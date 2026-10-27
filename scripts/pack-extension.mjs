// Packs extension/ into dist/PixeloramaMCP.zip. Pixelorama loads .zip files the
// same way as .pck, so no Godot export is needed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "extension");
const output = join(root, "dist", "PixeloramaMCP.zip");

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const local = [];
const central = [];
let offset = 0;

for (const file of listFiles(source).sort()) {
  const name = Buffer.from(relative(source, file).split("\\").join("/"));
  const data = readFileSync(file);
  const compressed = deflateRawSync(data);
  const crc = crc32(data);

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, compressed);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4); // version made by
  entry.writeUInt16LE(20, 6); // version needed
  entry.writeUInt16LE(8, 10); // deflate
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(compressed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);

  offset += header.length + name.length + compressed.length;
}

const centralSize = central.reduce((size, buf) => size + buf.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([...local, ...central, end]));
console.log(`Wrote ${relative(root, output)}`);
