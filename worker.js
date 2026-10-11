
const CACHE_KEY = "yemen-news-cache-v1";
const CACHE_TTL = 600;

async function fetchNews() {
  const params = new URLSearchParams({
    query: "Yemen",
    mode: "artlist",
    format: "json",
    maxrecords: "50",
    timespan: "3d"
  });

  const response = await fetch(
    "https://api.gdeltproject.org/api/v2/doc/doc?" + params,
    {
      headers: {
        "Accept": "application/json",
        "User-Agent": "YemenNewsSite/1.0"
      }
    }
  );

  if (!response.ok) {
    throw new Error("GDELT HTTP " + response.status);
  }

  const data = await response.json();

  if (!Array.isArray(data.articles)) {
    throw new Error("GDELT response has no articles array");
  }

  return data.articles
    .filter(a => a.url && a.title)
    .map(a => {
      let date = null;
      const rawDate = a.seendate || "";
      const m = rawDate.match(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/
      );

      if (m) {
        date = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
      }

      let domain = a.domain || "";
      try {
        domain = new URL(a.url).hostname.replace(/^www\./, "");
      } catch {}

      return {
        title: a.title,
        url: a.url,
        date,
        source: domain,
        domain,
        summary: "",
        language: a.language || ""
      };
    });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/news" && request.method === "GET") {
      const cache = await caches.open(CACHE_KEY);
      const cacheKey = new Request(
        url.origin + "/api/news?cached=1"
      );

      const cached = await cache.match(cacheKey);

      if (cached) {
        const age = Date.now() -
          new Date(cached.headers.get("X-Cached-At")).getTime();

        if (Number.isFinite(age) && age < CACHE_TTL * 1000) {
          return cached;
        }
      }

      try {
        const articles = await fetchNews();

        const result = Response.json({
          articles,
          updatedAt: new Date().toISOString(),
          warning: ""
        }, {
          headers: {
            "Cache-Control": "public, max-age=60",
            "X-Cached-At": new Date().toISOString()
          }
        });

        ctx.waitUntil(cache.put(cacheKey, result.clone()));
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
          warning: "تعذر جلب الأخبار حاليًا. حاول مرة أخرى لاحقًا.",
          diagnostic: String(error.message || error)
        }, {
          status: 502,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8"
          }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
