
const CACHE_KEY = "yemen-news-cache-v2";
const CACHE_TTL = 600;

const QUERIES = [
  '(Yemen OR Yemeni OR اليمن OR اليمنية)',
  '(Taiz OR تعز OR تعزّ) Yemen'
];

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").trim();
}

function relevant(article) {
  const text = [
    article.title || "",
    article.domain || "",
    article.url || ""
  ].join(" ").toLowerCase();

  return /yemen|yemeni|اليمن|تعز|taiz|ta'izz|taizz/.test(text);
}

async function fetchQuery(query) {
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: "50",
    timespan: "3d",
    sort: "datedesc"
  });

  const response = await fetch(
    "https://api.gdeltproject.org/api/v2/doc/doc?" + params,
    { headers: { "Accept": "application/json" } }
  );

  if (!response.ok) {
    throw new Error("GDELT HTTP " + response.status);
  }

  const data = await response.json();

  if (!Array.isArray(data.articles)) {
    throw new Error("GDELT response has no articles array");
  }

  return data.articles;
}

async function fetchNews() {
  // طلب واحد لتقليل احتمال الوصول إلى حد الطلبات.
  const raw = await fetchQuery(
    '(Yemen OR Yemeni OR اليمن OR تعز OR Taiz)'
  );

  const seen = new Set();

  return raw
    .filter(relevant)
    .map(a => {
      let domain = a.domain || "";

      try {
        domain = new URL(a.url).hostname.replace(/^www\./, "");
      } catch {}

      let date = null;
      const m = (a.seendate || "").match(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/
      );

      if (m) {
        date = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
      }

      return {
        title: cleanText(a.title) || "بدون عنوان",
        url: a.url || "",
        date,
        source: domain,
        domain,
        summary: "",
        language: a.language || ""
      };
    })
    .filter(a => {
      if (!a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/news" && request.method === "GET") {
      const cache = await caches.open(CACHE_KEY);
      const key = new Request(url.origin + "/api/news?cached=1");
      const cached = await cache.match(key);

      if (cached) {
        const timestamp = Number(cached.headers.get("X-Cached-At"));
        if (Date.now() - timestamp < CACHE_TTL * 1000) {
          return new Response(cached.body, {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "public, max-age=60",
              "X-News-Cache": "fresh"
            }
          });
        }
      }

      try {
        const articles = await fetchNews();

        const result = Response.json({
          articles,
          updatedAt: new Date().toISOString(),
          warning: articles.length
            ? ""
            : "لم يُعثر على أخبار مطابقة خلال الفترة المحددة."
        }, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-Cached-At": String(Date.now())
          }
        });

        ctx.waitUntil(cache.put(key, result.clone()));
        return result;
      } catch (error) {
        if (cached) {
          return new Response(cached.body, {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "X-News-Cache": "stale"
            }
          });
        }

        return Response.json({
          articles: [],
          updatedAt: null,
          warning: "تعذر جلب الأخبار حاليًا. حاول لاحقًا.",
          diagnostic: String(error.message || error)
        }, {
          status: 502,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
