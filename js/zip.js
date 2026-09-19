/* Minimal ZIP writer (store only, no compression — photos and videos are already compressed).
   Used to export the whole "Creator Studio / <creator> / Pics|Vids" tree as one file, which works on every phone
   (including iPhone, where a web app can't write into a chosen folder). */
(function (root) {
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8, crc) {
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    for (let i = 0; i < u8.length; i++) crc = TABLE[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  /* entries: [{ path: 'Zayn/Pics/a.jpg', blob: Blob }]  ·  a path ending in "/" adds an empty folder.
     onProgress(done, total) is optional. Returns a Blob. */
  async function build(entries, onProgress) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const stamp = dosTime(new Date());
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i], isDir = /\/$/.test(e.path);
      const name = enc.encode(e.path);
      let crc = 0, size = 0;
      if (!isDir) {
        // one file in memory at a time: read it for the checksum, then hand the Blob itself to the archive
        const buf = new Uint8Array(await e.blob.arrayBuffer());
        crc = crc32(buf, 0); size = buf.length;
      }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, stamp.time, true); lh.setUint16(12, stamp.date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name); if (!isDir) parts.push(e.blob);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, stamp.time, true); ch.setUint16(14, stamp.date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, isDir ? 0x10 : 0, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);

      offset += 30 + name.length + size;
      if (onProgress) onProgress(i + 1, entries.length);
    }
    let cdSize = 0;
    central.forEach(p => { cdSize += p.byteLength !== undefined ? p.byteLength : p.length; });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
  }

  const api = { build, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CSZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
