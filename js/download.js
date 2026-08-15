/* ═══ Eas_EV — download.js ═══
   Export selected datasets: CSV · GeoJSON · KML · Shapefile(zip via SHP) */

const DL = {
  refreshList(){
    const root=document.getElementById('dataList'); const items=[];
    if (MapMod.allStations.length) items.push({key:'stations',label:'⚡ EV stations',count:MapMod.allStations.length});
    Object.keys(Amen.layers).forEach(k=>{ const c=Amen.findCat(k); items.push({key:'am:'+k,label:`${c.icon} ${c.label}`,count:Amen.counts[k]||0}); });
    if (Trip.lastPlan) items.push({key:'route',label:'🧭 Trip route',count:1});
    if (MapMod.pinPos) items.push({key:'pin',label:'📍 Custom pin',count:1});
    if (MapMod.ctx.polygon) items.push({key:'boundary',label:'🗺️ Searched boundary',count:1});
    root.innerHTML=items.length
      ? items.map(it=>`<label class="data-item"><input type="checkbox" data-dl="${it.key}" checked>${it.label}<span class="dcnt">${it.count}</span></label>`).join('')
      : '<div class="note">Nothing loaded yet — search a place, load stations or amenities first.</div>';
  },
  selected(){ return [...document.querySelectorAll('[data-dl]:checked')].map(cb=>cb.dataset.dl); },

  collect(){
    const sel=this.selected(); const points=[],lines=[],polys=[];
    if (sel.includes('stations')) MapMod.allStations.forEach(s=>points.push({type:'Feature',properties:{dataset:'ev_station',name:s.name,charger_type:s.type,operator:s.operator,power_kw:s.powerKW,connector:s.connector||'',ports:s.ports,availability:s.availability||'',access:s.access||'',pricing:s.pricing||'',phone:s.phone||'',website:s.website||'',city:s.city||'',state:s.state||'',source:s.src},geometry:{type:'Point',coordinates:[s.lon,s.lat]}}));
    sel.filter(k=>k.startsWith('am:')).forEach(k=>{ const key=k.slice(3); Amen.getCache(key).forEach(x=>points.push({type:'Feature',properties:{dataset:'amenity',category:key,name:x.name,phone:x.tags.phone||'',hours:x.tags.opening_hours||''},geometry:{type:'Point',coordinates:[x.lon,x.lat]}})); });
    if (sel.includes('route')&&Trip.lastPlan){
      lines.push({type:'Feature',properties:{dataset:'trip_route',from:Trip.lastPlan.pts[0]?.name||'',to:Trip.lastPlan.pts.at(-1)?.name||'',distance_km:Trip.lastPlan.km,duration_min:Trip.lastPlan.min},geometry:Trip.lastPlan.route.geometry});
      Trip.lastPlan.pts.forEach((p,i)=>points.push({type:'Feature',properties:{dataset:'trip_stop',stop_index:i,name:p.name},geometry:{type:'Point',coordinates:[p.lon,p.lat]}}));
    }
    if (sel.includes('pin')&&MapMod.pinPos) points.push({type:'Feature',properties:{dataset:'custom_pin',radius_km:+document.getElementById('apRadius').value},geometry:{type:'Point',coordinates:[MapMod.pinPos.lon,MapMod.pinPos.lat]}});
    if (sel.includes('boundary')&&MapMod.ctx.polygon) polys.push({type:'Feature',properties:{dataset:'boundary',name:MapMod.ctx.label},geometry:MapMod.ctx.polygon});
    return { points, lines, polys };
  },

  download(format){
    const {points,lines,polys}=this.collect(); const all=[...points,...lines,...polys];
    if (!all.length){ U.toast('Select at least one dataset with data'); return; }
    const stamp=new Date().toISOString().slice(0,10);

    if (format==='geojson'){
      U.downloadBlob(JSON.stringify({type:'FeatureCollection',crs:{type:'name',properties:{name:'urn:ogc:def:crs:OGC:1.3:CRS84'}},features:all},null,1),`easev_${stamp}.geojson`,'application/geo+json');
      U.toast(`GeoJSON downloaded — <b>${all.length}</b> features`);
    }
    else if (format==='csv'){
      if (!points.length){ U.toast('CSV needs point data (stations/amenities)'); return; }
      const head=['dataset','name','category','lat','lon','extra'];
      const rows=points.map(f=>({dataset:f.properties.dataset,name:f.properties.name||'',category:f.properties.category||f.properties.charger_type||'',lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],extra:f.properties.operator||f.properties.phone||''}));
      const csv=[head.join(','),...rows.map(r=>head.map(h=>`"${String(r[h]??'').replace(/"/g,'""')}"`).join(','))].join('\n');
      U.downloadBlob('\ufeff'+csv,`easev_${stamp}.csv`,'text/csv;charset=utf-8');
      U.toast(`CSV downloaded — <b>${rows.length}</b> rows`);
    }
    else if (format==='kml'){
      const pm=points.map(f=>`<Placemark><name>${U.esc(f.properties.name||'')}</name><description>${U.esc(f.properties.dataset)}</description><Point><coordinates>${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}</coordinates></Point></Placemark>`).join('');
      const ln=lines.map(f=>`<Placemark><name>${U.esc(f.properties.from)}→${U.esc(f.properties.to)}</name><LineString><coordinates>${f.geometry.coordinates.map(c=>c[0]+','+c[1]).join(' ')}</coordinates></LineString></Placemark>`).join('');
      const kml=`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Eas_EV</name>${pm}${ln}</Document></kml>`;
      U.downloadBlob(kml,`easev_${stamp}.kml`,'application/vnd.google-earth.kml+xml');
      U.toast(`KML downloaded — <b>${all.length}</b> features`);
    }
    else if (format==='shp'){
      this.downloadSHP(points,lines,polys,stamp);
    }
  },

  async downloadSHP(points,lines,polys,stamp){
    if (typeof JSZip==='undefined'||typeof SHP==='undefined'){ U.toast('SHP libs missing — exporting GeoJSON'); this.download('geojson'); return; }
    const byLayer={};
    if (points.length) byLayer['points']=points;
    if (lines.length)  byLayer['routes']=lines.map(f=>({...f,geometry:f.geometry}));
    if (polys.length)  byLayer['boundaries']=polys.map(f=>({...f,geometry:f.geometry.type==='MultiPolygon'?{type:'Polygon',coordinates:f.geometry.coordinates[0]}:f.geometry}));
    if (!Object.keys(byLayer).length){ U.toast('No exportable geometry'); return; }
    try {
      U.toast('Building shapefile (.shp/.shx/.dbf/.prj/.cpg)…');
      await SHP.zipDownload(byLayer,`easev_shp_${stamp}.zip`);
      U.toast('Shapefile ZIP downloaded — opens in QGIS / ArcGIS');
    } catch(e){
      console.error(e); U.toast('SHP failed — exporting GeoJSON instead'); this.download('geojson');
    }
  },
};
