/* ═══ Eas_EV — amenities.js ═══
   Grouped categories · all enabled layers persist & show · Overpass */

const Amen = {
  CATALOG:{
    'Healthcare 🏥':{
      hospital:{q:'["amenity"="hospital"]',icon:'🏥',label:'Hospital'},
      clinic:{q:'["amenity"="clinic"]',icon:'🩺',label:'Clinic'},
      pharmacy:{q:'["amenity"="pharmacy"]',icon:'💊',label:'Pharmacy'},
      doctors:{q:'["amenity"="doctors"]',icon:'👨‍⚕️',label:'Doctors'},
    },
    'Food & Drink 🍽️':{
      restaurant:{q:'["amenity"="restaurant"]',icon:'🍽️',label:'Restaurant'},
      cafe:{q:'["amenity"="cafe"]',icon:'☕',label:'Cafe'},
      fast_food:{q:'["amenity"="fast_food"]',icon:'🍔',label:'Fast food'},
      bar:{q:'["amenity"="bar"]',icon:'🍺',label:'Bar'},
    },
    'Stay 🏨':{
      hotel:{q:'["tourism"="hotel"]',icon:'🏨',label:'Hotel'},
      guest_house:{q:'["tourism"="guest_house"]',icon:'🏠',label:'Guest house'},
      hostel:{q:'["tourism"="hostel"]',icon:'🛏️',label:'Hostel'},
    },
    'Transport 🚗':{
      parking:{q:'["amenity"="parking"]',icon:'🅿️',label:'Parking'},
      fuel:{q:'["amenity"="fuel"]',icon:'⛽',label:'Fuel station'},
      osm_charging:{q:'["amenity"="charging_station"]',icon:'🔌',label:'EV charge (OSM)'},
      bus_station:{q:'["amenity"="bus_station"]',icon:'🚌',label:'Bus station'},
      railway:{q:'["railway"="station"]',icon:'🚉',label:'Railway station'},
      car_repair:{q:'["shop"="car_repair"]',icon:'🔧',label:'Service centre'},
    },
    'Shopping 🛍️':{
      mall:{q:'["shop"="mall"]',icon:'🏬',label:'Mall'},
      supermarket:{q:'["shop"="supermarket"]',icon:'🛒',label:'Supermarket'},
      marketplace:{q:'["amenity"="marketplace"]',icon:'🧺',label:'Market'},
    },
    'Money & Safety 🏦':{
      bank:{q:'["amenity"="bank"]',icon:'🏦',label:'Bank'},
      atm:{q:'["amenity"="atm"]',icon:'🏧',label:'ATM'},
      police:{q:'["amenity"="police"]',icon:'🚓',label:'Police'},
      fire_station:{q:'["amenity"="fire_station"]',icon:'🚒',label:'Fire station'},
      toilets:{q:'["amenity"="toilets"]',icon:'🚻',label:'Washroom'},
    },
    'Public 🏛️':{
      post_office:{q:'["amenity"="post_office"]',icon:'📮',label:'Post office'},
      school:{q:'["amenity"="school"]',icon:'🏫',label:'School'},
      college:{q:'["amenity"="college"]',icon:'🎓',label:'College'},
      library:{q:'["amenity"="library"]',icon:'📚',label:'Library'},
    },
    'Leisure 🌳':{
      park:{q:'["leisure"="park"]',icon:'🌳',label:'Park'},
      cinema:{q:'["amenity"="cinema"]',icon:'🎬',label:'Cinema'},
      gym:{q:'["leisure"="fitness_centre"]',icon:'🏋️',label:'Gym'},
      worship:{q:'["amenity"="place_of_worship"]',icon:'🛕',label:'Worship'},
    },
  },
  layers:{}, counts:{}, _cache:{},

  buildUI(){
    let gi=0, html='';
    Object.entries(this.CATALOG).forEach(([g,cats])=>{
      const n=Object.keys(cats).length, gid='amg'+(gi++);
      html+=`<div class="am-group open" data-group="${U.esc(g)}">
        <div class="am-ghead">${g}
          <span class="am-gcount">${n}</span></div>
        <div class="am-gbody" id="${gid}">`;
      Object.entries(cats).forEach(([k,c])=>{
        html+=`<label class="am-item" data-amlabel="${U.esc(c.label.toLowerCase())}"><input type="checkbox" data-amcat="${k}"><span class="ico">${c.icon}</span>${c.label}<span class="acnt" id="acnt-${k}"></span></label>`;
      });
      html+=`</div></div>`;
    });
    const tools=`<div class="amen-tools">
      <div class="amen-presets">
        <span class="amen-preset" data-preset="clear">Clear all</span>
      </div></div>`;
    document.getElementById('amenityGroups').innerHTML=tools+html;
    document.querySelectorAll('.amen-preset').forEach(btn=>btn.addEventListener('click',async()=>{
      const p=btn.dataset.preset;
      if (p==='clear'){
        document.querySelectorAll('[data-amcat]:checked').forEach(cb=>{ cb.checked=false; this.hide(cb.dataset.amcat); });
        this.feedback('',false); DL.refreshList(); Store.save(); return;
      }
    }));
    /* each category is an independent toggle with live feedback */
    document.querySelectorAll('[data-amcat]').forEach(cb=>{
      cb.addEventListener('change',async ()=>{
        const k=cb.dataset.amcat, cat=this.findCat(k);
        if (cb.checked){
          this.feedback(`Searching ${cat.label}…`, true);
          const r=await this.load(k);
          this.feedback(`${r&&r.count!=null?r.count:0} ${cat.label} found`, false);
          DL.refreshList();
        } else { this.hide(k); this.feedback('', false); DL.refreshList(); }
        Store.save();
      });
    });
  },

  feedback(msg, loading){
    const el=document.getElementById('amFeedback'); if(!el) return;
    el.innerHTML = msg ? `${loading?'<span class="am-spin"></span>':'✓ '}${U.esc(msg)}` : '';
    el.style.display = msg ? 'flex' : 'none';
  },

  filterUI(q){
    q=(q||'').toLowerCase().trim();
    document.querySelectorAll('.am-item').forEach(it=>{
      const match=!q || (it.dataset.amlabel||'').includes(q);
      it.style.display = match ? '' : 'none';
    });
    document.querySelectorAll('.am-group').forEach(g=>{
      const anyVisible=[...g.querySelectorAll('.am-item')].some(it=>it.style.display!=='none');
      g.style.display = anyVisible ? '' : 'none';
    });
  },
  hide(key){
    if (this.layers[key]){ MapMod.map.removeLayer(this.layers[key]); delete this.layers[key]; }
    delete this.counts[key]; if (this._cache) delete this._cache[key];
    const el=document.getElementById('acnt-'+key); if (el) el.textContent='';
  },
  findCat(key){ for (const cats of Object.values(this.CATALOG)) if (cats[key]) return cats[key]; return null; },
  selectedKeys(){ return [...document.querySelectorAll('[data-amcat]:checked')].map(cb=>cb.dataset.amcat); },

  buildQuery(catQ){
    const c=MapMod.ctx;
    if (c.mode==='boundary'&&c.bbox){ const [s,w,n,e]=c.bbox; return `[out:json][timeout:40];(node${catQ}(${s},${w},${n},${e});way${catQ}(${s},${w},${n},${e}););out center 300;`; }
    /* radius around a center; if no center (neutral view), use the agent's location or current map centre */
    let center=c.center;
    if (!center||center.lat==null){ center = (MapMod.userPos&&MapMod.userPos.lat!=null) ? MapMod.userPos : (()=>{ const m=MapMod.map.getCenter(); return {lat:m.lat,lon:m.lng}; })(); }
    const r=(c.radiusKm||10)*1000;
    return `[out:json][timeout:40];(node${catQ}(around:${r},${center.lat},${center.lon});way${catQ}(around:${r},${center.lat},${center.lon}););out center 300;`;
  },

  OVERPASS_MIRRORS:[
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ],
  async overpassFetch(query){
    const mirrors=[CONFIG.OVERPASS, ...this.OVERPASS_MIRRORS].filter((v,i,a)=>a.indexOf(v)===i);
    let lastErr;
    for (const url of mirrors){
      /* two attempts per mirror: POST first (preferred), then GET fallback */
      for (const method of ['POST','GET']){
        try {
          const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),25000);
          const res=await fetch(method==='POST'?url:url+'?data='+encodeURIComponent(query),
            method==='POST'?{method:'POST',body:'data='+encodeURIComponent(query),signal:ctrl.signal}:{signal:ctrl.signal});
          clearTimeout(t);
          if (!res.ok) throw new Error('HTTP '+res.status);
          const data=await res.json();
          if (!data || !Array.isArray(data.elements)) throw new Error('bad payload');
          return data;
        } catch(e){ lastErr=e; }
      }
    }
    throw lastErr||new Error('all Overpass mirrors failed');
  },

  async load(key){
    const cat=this.findCat(key); if (!cat) return {error:'unknown'};
    try {
      const data=await this.overpassFetch(this.buildQuery(cat.q));
      let items=(data.elements||[]).map(e=>({ name:e.tags?.name||cat.label, lat:e.lat??e.center?.lat, lon:e.lon??e.center?.lon, tags:e.tags||{} })).filter(x=>x.lat&&x.lon);
      if (MapMod.ctx.mode==='boundary'&&MapMod.ctx.polygon) items=items.filter(x=>U.pointInGeoJSON(x.lon,x.lat,MapMod.ctx.polygon));
      this._render(key,cat,items);
      return { count:items.length, items:items.slice(0,12) };
    } catch(e){ return {error:'Amenity servers are busy right now — please try again in a moment'}; }
  },

  async loadAround(key,lat,lon,radiusM){
    const cat=this.findCat(key); if (!cat) return {error:'unknown'};
    try {
      const q=`[out:json][timeout:30];(node${cat.q}(around:${radiusM},${lat},${lon});way${cat.q}(around:${radiusM},${lat},${lon}););out center 200;`;
      const data=await this.overpassFetch(q);
      const items=(data.elements||[]).map(e=>({ name:e.tags?.name||cat.label, lat:e.lat??e.center?.lat, lon:e.lon??e.center?.lon, tags:e.tags||{} })).filter(x=>x.lat&&x.lon);
      this._render(key,cat,items);
      return { count:items.length };
    } catch(e){ return {error:'unreachable'}; }
  },

  /* colour family per amenity group for the 3D pins */
  GROUP_COLORS:{ 'Healthcare 🏥':'#ef476f','Food & Drink 🍽️':'#f78c2b','Stay 🏨':'#9b5de5','Transport 🚗':'#3a86ff',
    'Shopping 🛍️':'#ff70a6','Money & Safety 🏦':'#2a9d8f','Public 🏛️':'#118ab2','Leisure 🌳':'#43aa8b' },
  groupColorOf(key){ for (const [g,cats] of Object.entries(this.CATALOG)) if (cats[key]) return this.GROUP_COLORS[g]||'#3a86ff'; return '#3a86ff'; },

  _render(key,cat,items){
    if (this.layers[key]) MapMod.map.removeLayer(this.layers[key]);
    const lg=L.layerGroup();
    const col=this.groupColorOf(key);
    items.forEach((x,i)=>{
      const item=this.amenityToPOI(key,cat,x,i);
      L.marker([x.lat,x.lon],{ icon:MapMod.pin3D(cat.icon,col,32) })
        .bindPopup(POI.popupHTML(item),{ minWidth:230 })
        .on('popupopen',()=>POI.bindPopup(item))
        .addTo(lg);
    });
    if (Toggle.state.amenities!==false) lg.addTo(MapMod.map);
    this.layers[key]=lg; this.counts[key]=items.length; this._cache[key]=items;
    const el=document.getElementById('acnt-'+key); if (el) el.textContent=items.length;
  },

  /* universal POI shape for any amenity — exposes all useful OSM tags */
  amenityToPOI(key,cat,x,i){
    const t=x.tags||{};
    const addr=[t['addr:housenumber'],t['addr:street'],t['addr:city']].filter(Boolean).join(' ');
    return {
      id:`am-${key}-${i}-${Math.round(x.lat*1e4)}-${Math.round(x.lon*1e4)}`,
      name:x.name, kind:cat.label, subtitle:cat.label,
      lat:x.lat, lon:x.lon,
      phone:t.phone||t['contact:phone']||'',
      email:t.email||t['contact:email']||'',
      website:t.website||t['contact:website']||'',
      rows:[
        ['Address', addr],
        ['Hours', t.opening_hours||''],
        ['Email', t.email||t['contact:email']||'', t.email?`mailto:${t.email}`:''],
        ['Rating', t.stars||''],
        ['Cuisine', t.cuisine||''],
      ]
    };
  },

  async fetchNear(key,lat,lon,radiusM){
    const cat=this.findCat(key); if (!cat) return [];
    try {
      const q=`[out:json][timeout:25];(node${cat.q}(around:${radiusM},${lat},${lon});way${cat.q}(around:${radiusM},${lat},${lon}););out center 60;`;
      const data=await this.overpassFetch(q);
      return (data.elements||[]).map(e=>({name:e.tags?.name||cat.label,lat:e.lat??e.center?.lat,lon:e.lon??e.center?.lon,tags:e.tags||{}})).filter(x=>x.lat&&x.lon);
    } catch(e){ return []; }
  },

  /* Pulse-highlight a set of points on the map (used when a scan chip is clicked) */
  pulseHighlight(items){
    if (!items||!items.length) return;
    const pts=[];
    items.slice(0,120).forEach(x=>{
      const m=L.circleMarker([x.lat,x.lon],{radius:15,color:'#16a34a',weight:3,fillColor:'#22c55e',fillOpacity:.28,className:'pulse-hl'}).addTo(MapMod.map);
      pts.push([x.lat,x.lon]);
      setTimeout(()=>{ try{MapMod.map.removeLayer(m);}catch(e){} },2800);
    });
    if (pts.length){ try{ MapMod.map.fitBounds(L.latLngBounds(pts).pad(0.3)); }catch(e){} }
  },

  async countOnly(key,lat,lon,radiusM){
    const cat=this.findCat(key); if (!cat) return null;
    try {
      const q=`[out:json][timeout:20];(node${cat.q}(around:${radiusM},${lat},${lon}););out count;`;
      const data=await this.overpassFetch(q);
      return +(data.elements?.[0]?.tags?.nodes ?? data.elements?.[0]?.tags?.total ?? 0);
    } catch(e){ return null; }
  },

  /* load ALL selected categories — each persists as its own layer (nothing hidden) */
  async loadSelected(){
    const keys=this.selectedKeys();
    if (!keys.length){ U.toast('Select at least one category first'); return; }
    U.toast(`Loading <b>${keys.length}</b> categories…`);
    let total=0;
    for (const k of keys){ const r=await this.load(k); if (r.count) total+=r.count; }
    U.toast(`<b>${total}</b> places loaded across ${keys.length} categories`);
    DL.refreshList();
  },

  reloadActive(){ Object.keys(this.layers).forEach(k=>this.load(k)); },
  clearAll(){
    Object.values(this.layers).forEach(l=>MapMod.map.removeLayer(l));
    this.layers={}; this.counts={}; this._cache={};
    document.querySelectorAll('[data-amcat]').forEach(cb=>cb.checked=false);
    document.querySelectorAll('.acnt').forEach(e=>e.textContent='');
    DL.refreshList();
  },
  getCache(key){ return this._cache[key]||[]; },

  /* ═════════ AMENITIES REPORT (Word / Excel / PDF) ═════════
     Selected layers → scope table, marked area map, per-category density,
     and full per-amenity detail tables. Reuses Intel's docx/PDF builders. */
  _polyAreaKm2(poly){
    try{
      const g=poly.type?poly:(poly.geometry||poly);
      const rings = g.type==='Polygon' ? [g.coordinates[0]]
                  : g.type==='MultiPolygon' ? g.coordinates.map(p=>p[0]) : [];
      let a=0;
      rings.forEach(r=>{
        let s=0;
        for(let i=0;i<r.length-1;i++){
          const [x1,y1]=r[i],[x2,y2]=r[i+1];
          s+=(x2-x1)*(y2+y1);
        }
        const latM=r.reduce((t,p)=>t+p[1],0)/r.length;
        a+=Math.abs(s/2)*111.32*111.32*Math.cos(latM*Math.PI/180);
      });
      return a||null;
    }catch(e){ return null; }
  },

  async _reportMap(cats, ctx, label){
    const W=1100,H=800,pad=46;
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const x=cv.getContext('2d');
    x.fillStyle='#ffffff'; x.fillRect(0,0,W,H);
    /* frame the selected area */
    let mnLa=90,mxLa=-90,mnLo=180,mxLo=-180;
    const feedPt=(la,lo)=>{ mnLa=Math.min(mnLa,la);mxLa=Math.max(mxLa,la);mnLo=Math.min(mnLo,lo);mxLo=Math.max(mxLo,lo); };
    const feedGeom=g=>{ const walk=cc=>{ if(typeof cc[0]==='number') feedPt(cc[1],cc[0]); else cc.forEach(walk); };
      walk((g.type?g:(g.geometry||g)).coordinates); };
    if (ctx.mode==='boundary'&&ctx.polygon) feedGeom(ctx.polygon);
    else if (ctx.mode==='radius'&&ctx.center){ const d=(ctx.radiusKm||5)/95; feedPt(ctx.center.lat-d,ctx.center.lon-d); feedPt(ctx.center.lat+d,ctx.center.lon+d); }
    cats.forEach(c=>c.items.forEach(it=>feedPt(it.lat,it.lon)));
    if (mnLa>mxLa){ mnLa=6;mxLa=37;mnLo=68;mxLo=98; }
    const gr=(mxLa-mnLa)*0.07||0.02, grl=(mxLo-mnLo)*0.07||0.02;
    mnLa-=gr;mxLa+=gr;mnLo-=grl;mxLo+=grl;
    const sc=Math.min((W-pad*2)/((mxLo-mnLo)||1),(H-pad*2)/((mxLa-mnLa)||1));
    const px=lo=>pad+(lo-mnLo)*sc, py=la=>H-pad-(la-mnLa)*sc;
    /* area outline */
    if (ctx.mode==='boundary'&&ctx.polygon){
      const g=ctx.polygon.type?ctx.polygon:(ctx.polygon.geometry||ctx.polygon);
      const poly=cs=>{ x.beginPath(); cs.forEach(r=>{ r.forEach((pt,k)=>{ k?x.lineTo(px(pt[0]),py(pt[1])):x.moveTo(px(pt[0]),py(pt[1])); }); x.closePath(); }); x.fill(); x.stroke(); };
      x.fillStyle='#eef7f3'; x.strokeStyle='#0d9463'; x.lineWidth=2.5;
      if (g.type==='Polygon') poly(g.coordinates); else if (g.type==='MultiPolygon') g.coordinates.forEach(poly);
    } else if (ctx.mode==='radius'&&ctx.center){
      x.fillStyle='#eef7f3'; x.strokeStyle='#0d9463'; x.lineWidth=2.5;
      x.beginPath(); x.arc(px(ctx.center.lon),py(ctx.center.lat),(ctx.radiusKm||5)/95*sc,0,7); x.fill(); x.stroke();
      x.fillStyle='#0d9463'; x.beginPath(); x.arc(px(ctx.center.lon),py(ctx.center.lat),5,0,7); x.fill();
    }
    /* amenity dots, coloured per category */
    cats.forEach(c=>{
      x.fillStyle=c.color;
      c.items.forEach(it=>{ x.beginPath(); x.arc(px(it.lon),py(it.lat),5,0,7); x.fill();
        x.strokeStyle='#ffffff'; x.lineWidth=1.2; x.stroke(); });
    });
    /* title + legend */
    x.fillStyle='#16203a'; x.font='bold 26px Arial';
    x.fillText(`${label} — selected amenities`, pad, 34);
    let lx=pad;
    cats.forEach(c=>{ x.fillStyle=c.color; x.beginPath(); x.arc(lx+7,H-22,7,0,7); x.fill();
      x.fillStyle='#16203a'; x.font='14px Arial'; const t=`${c.label} (${c.n})`;
      x.fillText(t,lx+18,H-17); lx+=x.measureText(t).width+56; });
    return cv.toDataURL('image/png');
  },

  async report(fmt){
    const keys=Object.keys(this.layers);
    if (!keys.length){ U.toast('Load at least one amenity layer first (Load selected)'); return; }
    const ctx=MapMod.ctx||{mode:'none'};
    const label = ctx.label || (ctx.mode==='radius'&&ctx.radiusKm ? `${ctx.radiusKm} km search radius` : 'Current map area');
    let areaKm2=null;
    if (ctx.mode==='radius'&&ctx.radiusKm) areaKm2=Math.PI*ctx.radiusKm*ctx.radiusKm;
    else if (ctx.mode==='boundary'&&ctx.polygon) areaKm2=this._polyAreaKm2(ctx.polygon);
    const cats=keys.map(k=>{ const cat=this.findCat(k); const items=this._cache[k]||[];
      return { key:k, label:cat?.label||k, icon:cat?.icon||'📍', color:this.groupColorOf(k)||'#0d9463',
        n:items.length, density:areaKm2?+(items.length/areaKm2).toFixed(2):null, items }; })
      .filter(c=>c.n>0);
    if (!cats.length){ U.toast('Selected layers are empty — load amenities first'); return; }
    const total=cats.reduce((a,c)=>a+c.n,0);
    U.toast('Building amenities report…');
    const mapImg=await this._reportMap(cats, ctx, label);
    const stamp=new Date().toLocaleString();
    const fname=`Eas_EV_Amenities_${label.replace(/[^\w]+/g,'_').slice(0,40)}`;
    const meta={ scope:label, count:`${total} amenities · ${cats.length} categories`, docType:'AMENITIES REPORT' };

    const itemRow=(c,x)=>{ const t=x.tags||{};
      const addr=[t['addr:housenumber'],t['addr:street'],t['addr:suburb'],t['addr:city']].filter(Boolean).join(', ');
      const dist=(ctx.center)?U.haversine(ctx.center.lat,ctx.center.lon,x.lat,x.lon).toFixed(2):'';
      return [x.name||'—', addr||'—', t.phone||t['contact:phone']||'—',
        t.opening_hours||'—', t.website||t['contact:website']||'—', dist||'—',
        x.lat.toFixed(5), x.lon.toFixed(5)]; };

    /* sections shared by Word + PDF */
    const sections=[];
    sections.push({ h:'Report scope', table:{ head:['Item','Value'], rows:[
      ['Report','Selected Amenities Analysis'],
      ['Area', label],
      ['Area size', areaKm2?`${areaKm2.toFixed(1)} km²`:'—'],
      ['Categories selected', cats.map(c=>`${c.icon} ${c.label}`).join(', ')],
      ['Total amenities', String(total)],
      ['Generated', stamp]], cap:'Report scope' } });
    sections.push({ h:'Selected amenities — marked map',
      image:{ data:mapImg, cap:`${label} — every selected amenity marked, coloured by category`, w:560, h:410 }, pageBreak:true });
    sections.push({ h:'Amenity density in the selected area', table:{
      head:['Category','Count','Share %','Density (per km²)'],
      rows:[...cats.map(c=>[`${c.icon} ${c.label}`, c.n, Math.round(c.n/total*1000)/10, c.density??'—']),
            ['TOTAL', total, 100, areaKm2?+(total/areaKm2).toFixed(2):'—']],
      cap:'Counts, shares and spatial density per category' } });
    for (const c of cats){
      const CAPN=200;
      sections.push({ h:`${c.icon} ${c.label} — full details (${c.n})`, table:{
        head:['Name','Address','Phone','Hours','Website','Dist km','Lat','Lon'],
        rows:c.items.slice(0,CAPN).map(x=>itemRow(c,x)),
        cap:`${c.label}${c.n>CAPN?` — first ${CAPN} of ${c.n}`:''}` } });
    }

    if (fmt==='pdf'){ Intel._printPDF('Selected Amenities Report', meta, sections); return; }
    if (fmt==='docx'){
      await Intel.buildDocx('Selected Amenities Report', `${label} · ${stamp}`, meta, sections, fname);
      U.toast('📄 Amenities Word report downloaded'); return;
    }
    /* ── enriched Excel ── */
    if (typeof XLSX==='undefined'){ U.toast('Excel library not loaded'); return; }
    const wb=XLSX.utils.book_new();
    const rep=[['Eas_EV — Selected Amenities Report'],
      ['Area', label], ['Area size', areaKm2?`${areaKm2.toFixed(1)} km²`:'—'],
      ['Total amenities', total], ['Categories', cats.length], ['Generated', stamp], [],
      ['WORKBOOK CONTENTS','']];
    rep.push(['Density','Counts, shares, density per km² with visual bars']);
    cats.forEach((c,i)=>rep.push([`Sheet ${i+2}`, `${c.label} — ${c.n} items, full details`]));
    const wsR=XLSX.utils.aoa_to_sheet(rep); wsR['!cols']=[{wch:24},{wch:100}];
    XLSX.utils.book_append_sheet(wb,wsR,'Report');
    const mx=Math.max(...cats.map(c=>c.n),1);
    const dAoa=[[`Amenity density — ${label}`],[areaKm2?`Area ${areaKm2.toFixed(1)} km²`:'' ],[],
      ['Category','Count','Share %','Density /km²','Bar (visual)'],
      ...cats.map(c=>[c.label, c.n, Math.round(c.n/total*1000)/10, c.density??'—', Intel._xlsxBar(c.n,mx)]),
      ['TOTAL', total, 100, areaKm2?+(total/areaKm2).toFixed(2):'—','']];
    const wsD=XLSX.utils.aoa_to_sheet(dAoa); wsD['!cols']=[{wch:26},{wch:8},{wch:9},{wch:13},{wch:28}];
    XLSX.utils.book_append_sheet(wb,wsD,'Density');
    cats.forEach(c=>{
      const head=['Name','Address','Phone','Hours','Website','Dist km','Lat','Lon'];
      const ws=XLSX.utils.aoa_to_sheet([[`${c.label} — ${c.n} amenities in ${label}`],[],head,
        ...c.items.map(x=>itemRow(c,x))]);
      ws['!cols']=[{wch:32},{wch:34},{wch:14},{wch:16},{wch:26},{wch:8},{wch:10},{wch:10}];
      XLSX.utils.book_append_sheet(wb, ws, Intel._wsName(c.label));
    });
    XLSX.writeFile(wb, fname+'.xlsx');
    const a=document.createElement('a'); a.href=mapImg; a.download=fname+'_map.png'; a.click();
    U.toast('📊 Amenities Excel report + map PNG downloaded');
  },
};
