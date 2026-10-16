import * as zlib from 'node:zlib';

export interface ZipFileEntry {
  name: string;
  content: string | Buffer;
}

/**
 * Creates an uncompressed in-memory ZIP archive compatible with AWS Lambda.
 * Uses standard Node.js zlib.crc32 with zero external dependencies.
 */
export function createZipArchive(files: ZipFileEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const data = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, 'utf-8');
    const nameBuf = Buffer.from(file.name, 'utf-8');
    const crc = zlib.crc32(data);
    const size = data.length;

    // Local file header (30 bytes + nameBuf.length)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed
    localHeader.writeUInt16LE(0, 6);          // General purpose bit flag
    localHeader.writeUInt16LE(0, 8);          // Compression method: 0 (Stored)
    localHeader.writeUInt16LE(0, 10);         // Last mod time
    localHeader.writeUInt16LE(0, 12);         // Last mod date
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(size, 18);      // Compressed size
    localHeader.writeUInt32LE(size, 22);      // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, data);

    // Central directory file header (46 bytes + nameBuf.length)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4);         // Version made by
    centralHeader.writeUInt16LE(20, 6);         // Version needed
    centralHeader.writeUInt16LE(0, 8);          // Flags
    centralHeader.writeUInt16LE(0, 10);         // Compression method: 0
    centralHeader.writeUInt16LE(0, 12);         // Mod time
    centralHeader.writeUInt16LE(0, 14);         // Mod date
    centralHeader.writeUInt32LE(crc, 16);       // CRC-32
    centralHeader.writeUInt32LE(size, 20);      // Compressed size
    centralHeader.writeUInt32LE(size, 24);      // Uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30);         // Extra field length
    centralHeader.writeUInt16LE(0, 32);         // File comment length
    centralHeader.writeUInt16LE(0, 34);         // Disk number start
    centralHeader.writeUInt16LE(0, 36);         // Internal file attributes
    centralHeader.writeUInt32LE(0, 38);         // External file attributes
    centralHeader.writeUInt32LE(offset, 42);    // Relative offset of local header
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) {
    centralDirSize += ch.length;
  }

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);                 // EOCD signature
  eocd.writeUInt16LE(0, 4);                          // Number of this disk
  eocd.writeUInt16LE(0, 6);                          // Disk where central dir starts
  eocd.writeUInt16LE(files.length, 8);               // Number of central dir records on disk
  eocd.writeUInt16LE(files.length, 10);              // Total number of central dir records
  eocd.writeUInt32LE(centralDirSize, 12);            // Size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16);          // Offset of central directory
  eocd.writeUInt16LE(0, 20);                         // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}
