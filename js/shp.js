/* ═══ Eas_EV — shp.js ═══
   Minimal but correct ESRI Shapefile writer (WGS84).
   Produces .shp + .shx + .dbf + .prj + .cpg per geometry type,
   zipped with JSZip. Compatible with QGIS / ArcGIS Pro / ArcMap. */

const SHP = {

  WGS84_PRJ: 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',

  /* features: GeoJSON features (Point | LineString | Polygon / MultiPolygon→first ring) */
  async zipDownload(featuresByLayer, filename) {
    const zip = new JSZip();
    for (const [layerName, feats] of Object.entries(featuresByLayer)) {
      if (!feats.length) continue;
      const gtype = feats[0].geometry.type;
      const files = gtype === 'Point' ? this.writePoints(feats)
                  : gtype === 'LineString' ? this.writeLines(feats)
                  : this.writePolys(feats);
      zip.file(layerName + '.shp', files.shp);
      zip.file(layerName + '.shx', files.shx);
      zip.file(layerName + '.dbf', files.dbf);
      zip.file(layerName + '.prj', this.WGS84_PRJ);
      zip.file(layerName + '.cpg', 'UTF-8');
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    U.downloadBlob(blob, filename, 'application/zip');
  },

  /* ───── geometry writers ───── */

  writePoints(feats) {
    const n = feats.length;
    const recLen = 8 + 20;                       // header(8) + type(4)+x(8)+y(8)
    const shpLen = 100 + n * recLen;
    const shp = new DataView(new ArrayBuffer(shpLen));
    const shx = new DataView(new ArrayBuffer(100 + n * 8));
    const bbox = this.bboxOf(feats);

    this.mainHeader(shp, shpLen, 1, bbox);
    this.mainHeader(shx, 100 + n * 8, 1, bbox);

    let off = 100;
    feats.forEach((f, i) => {
      const [x, y] = f.geometry.coordinates;
      shp.setInt32(off, i + 1);                  // record number (BE)
      shp.setInt32(off + 4, 10);                 // content length in 16-bit words (BE)
      shp.setInt32(off + 8, 1, true);            // shape type point (LE)
      shp.setFloat64(off + 12, x, true);
      shp.setFloat64(off + 20, y, true);
      shx.setInt32(100 + i * 8, off / 2);        // offset in words
      shx.setInt32(100 + i * 8 + 4, 10);
      off += recLen;
    });
    return { shp: shp.buffer, shx: shx.buffer, dbf: this.writeDBF(feats) };
  },

  writeLines(feats)  { return this._writeMulti(feats, 3, f => [f.geometry.coordinates]); },
  writePolys(feats)  {
    return this._writeMulti(feats, 5, f => {
      let rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates
                : f.geometry.coordinates[0];                 // MultiPolygon → first poly
      /* ensure closed rings, outer ring clockwise */
      return rings.map((r, i) => {
        let ring = r.slice();
        const [fx, fy] = ring[0], [lx, ly] = ring[ring.length-1];
        if (fx !== lx || fy !== ly) ring.push(ring[0]);
        const cw = this.ringArea(ring) < 0;
        if ((i === 0 && !cw) || (i > 0 && cw)) ring.reverse();
        return ring;
      });
    });
  },

  _writeMulti(feats, shapeType, getParts) {
    /* first pass: sizes */
    const metas = feats.map(f => {
      const parts = getParts(f);
      const npts = parts.reduce((s, p) => s + p.length, 0);
      const content = 4 + 32 + 4 + 4 + parts.length*4 + npts*16;  // type+bbox+numParts+numPts+parts+pts
      return { parts, npts, content };
    });
    const shpLen = 100 + metas.reduce((s, m) => s + 8 + m.content, 0);
    const shp = new DataView(new ArrayBuffer(shpLen));
    const shx = new DataView(new ArrayBuffer(100 + feats.length * 8));
    const bbox = this.bboxOf(feats, true);

    this.mainHeader(shp, shpLen, shapeType, bbox);
    this.mainHeader(shx, 100 + feats.length * 8, shapeType, bbox);

    let off = 100;
    metas.forEach((m, i) => {
      shp.setInt32(off, i + 1);
      shp.setInt32(off + 4, m.content / 2);
      let p = off + 8;
      shp.setInt32(p, shapeType, true); p += 4;
      const fb = this.bboxOf([feats[i]], true);
      [fb[0], fb[1], fb[2], fb[3]].forEach(v => { shp.setFloat64(p, v, true); p += 8; });
      shp.setInt32(p, m.parts.length, true); p += 4;
      shp.setInt32(p, m.npts, true); p += 4;
      let idx = 0;
      m.parts.forEach(part => { shp.setInt32(p, idx, true); p += 4; idx += part.length; });
      m.parts.forEach(part => part.forEach(([x, y]) => {
        shp.setFloat64(p, x, true); shp.setFloat64(p + 8, y, true); p += 16;
      }));
      shx.setInt32(100 + i * 8, off / 2);
      shx.setInt32(100 + i * 8 + 4, m.content / 2);
      off += 8 + m.content;
    });
    return { shp: shp.buffer, shx: shx.buffer, dbf: this.writeDBF(feats) };
  },

  mainHeader(dv, byteLen, shapeType, bbox) {
    dv.setInt32(0, 9994);                  // file code BE
    dv.setInt32(24, byteLen / 2);          // length in words BE
    dv.setInt32(28, 1000, true);           // version LE
    dv.setInt32(32, shapeType, true);
    dv.setFloat64(36, bbox[0], true);      // xmin
    dv.setFloat64(44, bbox[1], true);      // ymin
    dv.setFloat64(52, bbox[2], true);      // xmax
    dv.setFloat64(60, bbox[3], true);      // ymax
  },

  bboxOf(feats, multi = false) {
    let xmin=Infinity, ymin=Infinity, xmax=-Infinity, ymax=-Infinity;
    const eat = ([x, y]) => {
      if (x<xmin) xmin=x; if (x>xmax) xmax=x;
      if (y<ymin) ymin=y; if (y>ymax) ymax=y;
    };
    feats.forEach(f => {
      const g = f.geometry;
      if (g.type === 'Point') eat(g.coordinates);
      else if (g.type === 'LineString') g.coordinates.forEach(eat);
      else if (g.type === 'Polygon') g.coordinates.forEach(r => r.forEach(eat));
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => p.forEach(r => r.forEach(eat)));
    });
    return [xmin, ymin, xmax, ymax];
  },

  ringArea(ring) {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++)
      a += (ring[i+1][0]-ring[i][0]) * (ring[i+1][1]+ring[i][1]);
    return a;   // <0 = clockwise in this formulation
  },

  /* ───── DBF (dBase III) ───── */
  writeDBF(feats) {
    /* collect fields from properties (strings, max 254 chars, names ≤10) */
    const fieldSet = new Map();
    feats.forEach(f => Object.keys(f.properties || {}).forEach(k => {
      const name = k.slice(0, 10).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
      const len = Math.min(120, Math.max(fieldSet.get(name) || 1,
        ...feats.map(ff => this.toAscii(String(ff.properties?.[k] ?? '')).length)));
      fieldSet.set(name, Math.max(1, len));
    }));
    const fields = [...fieldSet.entries()];
    if (!fields.length) fields.push(['ID', 8]);

    const headerLen = 32 + fields.length * 32 + 1;
    const recLen = 1 + fields.reduce((s, [,l]) => s + l, 0);
    const buf = new ArrayBuffer(headerLen + recLen * feats.length + 1);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);

    const now = new Date();
    dv.setUint8(0, 3);                              // dBase III
    dv.setUint8(1, now.getFullYear() - 1900);
    dv.setUint8(2, now.getMonth() + 1);
    dv.setUint8(3, now.getDate());
    dv.setUint32(4, feats.length, true);
    dv.setUint16(8, headerLen, true);
    dv.setUint16(10, recLen, true);

    /* field descriptors */
    fields.forEach(([name, len], i) => {
      const o = 32 + i * 32;
      for (let c = 0; c < name.length; c++) u8[o + c] = name.charCodeAt(c);
      u8[o + 11] = 'C'.charCodeAt(0);               // char type
      u8[o + 16] = len;
    });
    u8[32 + fields.length * 32] = 0x0D;             // header terminator

    /* records */
    const origKeys = {};   // map field name back to original property key
    feats.forEach(f => Object.keys(f.properties || {}).forEach(k => {
      origKeys[k.slice(0,10).replace(/[^A-Za-z0-9_]/g,'_').toUpperCase()] = k;
    }));
    feats.forEach((f, ri) => {
      let o = headerLen + ri * recLen;
      u8[o] = 0x20; o += 1;                          // not deleted
      fields.forEach(([name, len]) => {
        const val = this.toAscii(String(f.properties?.[origKeys[name]] ?? '')).slice(0, len);
        for (let c = 0; c < len; c++)
          u8[o + c] = c < val.length ? val.charCodeAt(c) : 0x20;
        o += len;
      });
    });
    u8[buf.byteLength - 1] = 0x1A;                  // EOF
    return buf;
  },

  toAscii(s) {
    /* DBF is safest as ASCII; transliterate or strip non-ASCII */
    return s.normalize('NFKD').replace(/[^\x20-\x7E]/g, '?');
  },
};
