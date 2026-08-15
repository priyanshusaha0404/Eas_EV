/* ═══ Eas_EV — utils.js ═══ */
const U = {

  haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, p = Math.PI / 180;
    const dLat = (lat2-lat1)*p, dLon = (lon2-lon1)*p;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },

  pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length-1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj-xi)*(lat-yi)/(yj-yi)+xi)) inside = !inside;
    }
    return inside;
  },

  pointInGeoJSON(lon, lat, geom) {
    if (!geom) return true;
    if (geom.type === 'Polygon') {
      if (!this.pointInRing(lon, lat, geom.coordinates[0])) return false;
      for (let h = 1; h < geom.coordinates.length; h++)
        if (this.pointInRing(lon, lat, geom.coordinates[h])) return false;
      return true;
    }
    if (geom.type === 'MultiPolygon')
      return geom.coordinates.some(poly => {
        if (!this.pointInRing(lon, lat, poly[0])) return false;
        for (let h = 1; h < poly.length; h++)
          if (this.pointInRing(lon, lat, poly[h])) return false;
        return true;
      });
    return true;
  },

  toast(html, ms = 3200) {
    const t = document.getElementById('toast');
    t.innerHTML = html;
    t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('show'), ms);
  },

  rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  },

  fmtTime(min) {
    const h = Math.floor(min/60), m = Math.round(min%60);
    return h ? `${h}h ${m}m` : `${m}m`;
  },

  etaClock(min) {
    const d = new Date(Date.now() + min*60000);
    return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  },

  downloadBlob(content, filename, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  store(key, val) {
    try { localStorage.setItem('gca_'+key, JSON.stringify(val)); } catch(e){}
  },
  load(key, fallback) {
    try { const v = localStorage.getItem('gca_'+key); return v ? JSON.parse(v) : fallback; }
    catch(e){ return fallback; }
  },

  makeSpeech(onResult, onEnd) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.onresult = e => onResult(e.results[0][0].transcript);
    rec.onend = () => onEnd && onEnd();
    rec.onerror = () => onEnd && onEnd();
    return rec;
  },

  cleanForSpeech(t){
    return String(t)
      .replace(/[*_#`~>|]/g,' ')            // markdown symbols — never pronounced
      .replace(/\[(.*?)\]\(.*?\)/g,'$1')     // links → label only
      .replace(/[•·◦▪–—-]{2,}/g,', ')
      .replace(/:\w+:/g,'')
      .replace(/\s{2,}/g,' ').trim();
  },
  speak(text) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).slice(0, 400));
      u.lang = /[\u0980-\u09FF]/.test(text) ? 'bn-IN' : 'en-IN';
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
    } catch(e){}
  },

  async resizeImage(file, maxDim = 1100) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, maxDim/Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width*sc); cv.height = Math.round(img.height*sc);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', .86).split(',')[1]);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  },

  /* GPX from route geometry + waypoints */
  buildGPX(name, coords, waypoints) {
    const wpts = (waypoints||[]).map(w =>
      `  <wpt lat="${w.lat}" lon="${w.lon}"><name>${this.esc(w.name||'Stop')}</name></wpt>`).join('\n');
    const trkpts = coords.map(c =>
      `      <trkpt lat="${c[1]}" lon="${c[0]}"></trkpt>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Eas_EV" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${this.esc(name)}</name><time>${new Date().toISOString()}</time></metadata>
${wpts}
  <trk><name>${this.esc(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
  },
};
