const QUERIES = [
  '(Yemen OR اليمن)',
  '(Taiz OR تعز) Yemen'
];
function clean(value='') { return String(value).replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim(); }
function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } }
async function fetchQuery(query) {
  const params = new URLSearchParams({query, mode:'ArtList', format:'json', maxrecords:'50', sort:'DateDesc', timespan:'3d'});
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + params.toString();
  const response = await fetch(url, {headers:{'Accept':'application/json'}, cf:{cacheTtl:180, cacheEverything:true}});
  if (!response.ok) throw new Error('News source returned ' + response.status);
  const data = await response.json();
  return Array.isArray(data.articles) ? data.articles : [];
}
export async function onRequestGet() {
  try {
    const batches = await Promise.allSettled(QUERIES.map(fetchQuery));
    const articles = batches.flatMap(x => x.status === 'fulfilled' ? x.value : []);
    const unique = new Map();
    for (const a of articles) {
      const url = a.url || a.url_mobile;
      const title = clean(a.title || '');
      if (!url || !title || !/^https?:\/\//i.test(url)) continue;
      const key = url.split('#')[0].split('?')[0];
      if (!unique.has(key)) unique.set(key, {
        title, url, date: a.seendate ? new Date(a.seendate).toISOString() : null,
        source: clean(a.source || domainOf(url)), domain: domainOf(url),
        summary: clean(a.socialimage ? '' : (a.snippet || a.description || '')).slice(0,260)
      });
    }
    const result = [...unique.values()].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,70);
    return new Response(JSON.stringify({articles:result, updatedAt:new Date().toISOString(), warning:batches.every(x=>x.status==='rejected')?'لم تستجب خدمة الأخبار الخارجية.':''}), {
      headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=180','Access-Control-Allow-Origin':'*'}
    });
  } catch (e) {
    return new Response(JSON.stringify({articles:[],warning:'تعذر جلب الأخبار من المصدر الخارجي مؤقتًا.'}), {status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  }
}
