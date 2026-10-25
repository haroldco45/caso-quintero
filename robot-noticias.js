// Robot de Caso Quintero al Día — lo corre GitHub Actions cada 30 minutos.
// Trae noticias reales (Bing News y Google News), fotos reales (Wikipedia/Wikimedia Commons)
// y videos reales (YouTube) y lo guarda todo en data/noticias.json
const fs = require('fs');

const QUERIES = ['Daniel Quintero', 'Miguel Quintero', 'Diana Toro Inder', 'Jhonny Jaramillo oro', 'Metroparques Fiscalía'];
const VIDEO_QUERIES = ['Daniel Quintero Inder Noticias Caracol', 'Diana Toro Inder Fiscalía', 'Miguel Quintero casa por cárcel', 'Jhonny Jaramillo Quintero oro'];
const KEYS = /quintero|inder|metroparques|jaramillo|diana toro|cyan|área metropolitana|aguas vivas/i;
// Fotos fijas desde Wikipedia: clave = donde se usa en la app
const WIKI = [
  { clave: 'daniel', pagina: 'Daniel_Quintero_Calle', titulo: 'Daniel Quintero Calle' },
  { clave: 'medellin', pagina: 'Medellín', titulo: 'Medellín' },
  { clave: 'alpujarra', pagina: 'Centro_Administrativo_La_Alpujarra', titulo: 'Centro Administrativo La Alpujarra' },
  { clave: 'parquenorte', pagina: 'Parque_Norte_J._Emilio_Valderrama', titulo: 'Parque Norte, Metroparques' },
  { clave: 'fiscalia', pagina: 'Fiscalía_General_de_la_Nación_(Colombia)', titulo: 'Fiscalía General de la Nación' }
];

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Accept-Language': 'es-CO,es;q=0.9' };
const tag = (xml, t) => {
  const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
};
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const llave = t => t.toLowerCase().replace(/[^a-záéíóúñ0-9]/g, '').slice(0, 70);

async function get(url) {
  try { const r = await fetch(url, { headers: UA }); return r.ok ? await r.text() : ''; } catch { return ''; }
}

function parse(xml, src) {
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map(it => {
    let titulo = decode(tag(it, 'title'));
    let fuente = decode(tag(it, 'News:Source') || tag(it, 'source'));
    if (!fuente && titulo.includes(' - ')) { fuente = titulo.split(' - ').pop(); titulo = titulo.replace(/ - [^-]+$/, ''); }
    let imagen = decode(tag(it, 'News:Image'));
    if (imagen.startsWith('/')) imagen = 'https://www.bing.com' + imagen;
    if (imagen) imagen = imagen.replace(/&w=\d+&h=\d+/, '') + (imagen.includes('?') ? '&w=900' : '');
    return { titulo, url: decode(tag(it, 'link')), fecha: tag(it, 'pubDate'), fuente: fuente || src, imagen };
  });
}

async function fotosWiki() {
  const out = {};
  for (const w of WIKI) {
    const t = await get(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w.pagina)}`);
    try {
      const j = JSON.parse(t);
      const src = j.originalimage?.source || j.thumbnail?.source;
      if (src) out[w.clave] = { imagen: (j.thumbnail?.source || src).replace(/\/\d+px-/, '/1200px-'), original: src, titulo: w.titulo, credito: 'Wikimedia Commons', url: j.content_urls?.desktop?.page || '' };
    } catch {}
  }
  return out;
}

async function videosYouTube() {
  const vistos = new Map();
  for (const q of VIDEO_QUERIES) {
    const html = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=CAI%253D`); // ordenados por fecha
    const bloques = html.split('"videoRenderer":{').slice(1, 15);
    for (const b of bloques) {
      const id = (b.match(/^"videoId":"([\w-]{11})"/) || [])[1];
      const titulo = (b.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/) || [])[1];
      const canal = (b.match(/"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/) || [])[1] || '';
      const hace = (b.match(/"publishedTimeText":\{"simpleText":"([^"]*)"/) || [])[1] || '';
      if (!id || !titulo) continue;
      const t = JSON.parse(`"${titulo}"`);
      if (!KEYS.test(t) || vistos.has(id)) continue;
      vistos.set(id, { id, titulo: t, canal: JSON.parse(`"${canal}"`), hace });
    }
  }
  return [...vistos.values()].slice(0, 9);
}

(async () => {
  let all = [];
  for (const q of QUERIES) {
    const e = encodeURIComponent(q);
    all.push(...parse(await get(`https://www.bing.com/news/search?q=${e}&format=rss&setlang=es-co`), 'Bing'));
    all.push(...parse(await get(`https://news.google.com/rss/search?q=${e}+when:14d&hl=es-419&gl=CO&ceid=CO:es-419`), 'Google'));
  }
  const seen = new Map();
  for (const n of all) {
    if (!n.titulo || !KEYS.test(n.titulo)) continue;
    const k = llave(n.titulo), p = seen.get(k);
    if (!p) seen.set(k, n); else if (!p.imagen && n.imagen) p.imagen = n.imagen;
  }
  // Conserva lo que ya tenía para no perder historial, fotos ni videos si una fuente falla
  let viejo = {};
  try { viejo = JSON.parse(fs.readFileSync('data/noticias.json', 'utf8')); } catch {}
  for (const n of viejo.items || []) { const k = llave(n.titulo); if (!seen.has(k)) seen.set(k, n); }
  const items = [...seen.values()].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 150);

  const fotos = Object.assign({}, viejo.fotos || {}, await fotosWiki());
  let videos = await videosYouTube();
  if (!videos.length) videos = viejo.videos || [];

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/noticias.json', JSON.stringify({ actualizado: new Date().toISOString(), items, fotos, videos }, null, 1));
  console.log(`Listo: ${items.length} noticias, ${Object.keys(fotos).length} fotos, ${videos.length} videos`);
})();
