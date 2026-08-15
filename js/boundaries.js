/* ═══ Eas_EV — boundaries.js ═══
   Official GADM India admin boundaries (level 0 country, 1 state, 2 district).
   Loaded lazily; used to draw accurate boundaries on search instead of
   OpenStreetMap's bbox polygons.                                          */

const Boundaries = {
  india: null,
  states: null,
  districts: null,
  _loading: {},

  async load(which) {
    if (this[which]) return this[which];
    if (this._loading[which]) return this._loading[which];
    this._loading[which] = (async () => {
      try {
        const res = await fetch(`data/boundaries/${which}.geojson`);
        this[which] = await res.json();
        return this[which];
      } catch (e) {
        console.warn('boundary load failed:', which, e);
        return null;
      }
    })();
    return this._loading[which];
  },

  norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  },

  /* find a state feature by (fuzzy) name */
  async findState(name) {
    await this.load('states');
    if (!this.states) return null;
    const q = this.norm(name);
    let best = null;
    for (const f of this.states.features) {
      const n = this.norm(f.properties.name);
      if (n === q) return f;
      if (!best && (n.includes(q) || q.includes(n))) best = f;
    }
    return best;
  },

  /* find a district feature by (fuzzy) name, optionally within a state */
  async findDistrict(name, stateName) {
    await this.load('districts');
    if (!this.districts) return null;
    const q = this.norm(name);
    const qs = stateName ? this.norm(stateName) : null;
    let best = null;
    for (const f of this.districts.features) {
      const n = this.norm(f.properties.name);
      const sMatch = !qs || this.norm(f.properties.state).includes(qs) || qs.includes(this.norm(f.properties.state));
      if (n === q && sMatch) return f;
      if (!best && sMatch && (n.includes(q) || q.includes(n))) best = f;
    }
    return best;
  },

  /* Try to resolve any Nominatim result to an official boundary.
     Returns a GeoJSON Feature or null. */
  async resolve(nominatimResult) {
    const type = (nominatimResult.addresstype || nominatimResult.type || '').toLowerCase();
    const name = (nominatimResult.display_name || '').split(',')[0].trim();
    const addr = nominatimResult.address || {};

    if (type === 'country' || /india/i.test(name)) {
      await this.load('india');
      return this.india ? this.india.features[0] : null;
    }
    if (['state','region','province'].includes(type) || addr.state && this.norm(addr.state) === this.norm(name)) {
      return await this.findState(name);
    }
    if (['state_district','county','district','municipality'].includes(type)) {
      return await this.findDistrict(name, addr.state);
    }
    return null;
  },

  featureBounds(feature) {
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    const scan = coords => {
      if (typeof coords[0] === 'number') {
        minLon = Math.min(minLon, coords[0]); maxLon = Math.max(maxLon, coords[0]);
        minLat = Math.min(minLat, coords[1]); maxLat = Math.max(maxLat, coords[1]);
      } else coords.forEach(scan);
    };
    scan(feature.geometry.coordinates);
    return [minLat, minLon, maxLat, maxLon];
  },
};
