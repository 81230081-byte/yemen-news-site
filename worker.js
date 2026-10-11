
const CACHE_KEY = "latest-yemen-news";
const FRESH_SECONDS = 600;

function fixText(value) {
  if (typeof value !== "string") return "";

  // إصلاح بعض حالات تشوّه العربية الناتجة عن قراءة UTF-8 بترميز خاطئ.
  if (/[ØÙ]/.test(value) && [...value].every(c => c.codePointAt(0) <= 255)) {
    try {
      const bytes = Uint8Array.from(
        [...value].map(c => c.codePointAt(0))
      );
      const repaired = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/[\u0600-\u06FF]/.test(repaired)) return repaired;
    } catch {}
  }

  return value.normalize("NFC").trim();
}

function isRelevant(a) {
  const text = `${a.title || ""} ${a.url || ""} ${a.domain || ""}`;
  return /yemen|yemeni|اليمن|تعز|taiz|taizz|ta'izz/i.test(text);
}

async function fetchNews() {
  const params = new URLSearchParams({
    query: "Yemen OR Yemeni OR اليمن OR تعز OR Taiz",
    mode: "artlist",
    format: "json",
    maxrecords: "50",
    timespan: "3d",
    sort: "datedesc"
  });

  const response = await fetch(
    "https://api.gdeltproject.org/api/v2/doc/doc?" + params,
    { headers: { Accept: "application/json" } }
  );

  if (!response.ok) {
    throw new Error("GDELT HTTP " + response.status);
  }

  const data = await response.json();

  if (!Array.isArray(data.articles)) {
    throw new Error("GDELT response has no articles array");
  }

  const seen = new Set();

  return data.articles
    .filter(isRelevant)
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
        title: fixText(a.title) || "بدون عنوان",
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
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/news" && request.method === "GET") {
      let saved = null;

      try {
        saved = await env.NEWS_CACHE.get(CACHE_KEY, "json");
      } catch (error) {
        return Response.json({
          articles: [],
          warning: "تعذر الوصول إلى مخزن الأخبار.",
          diagnostic: String(error.message || error)
        }, {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }

      if (
        saved &&
        Array.isArray(saved.articles) &&
        saved.updatedAt &&
        Date.now() - Date.parse(saved.updatedAt) < FRESH_SECONDS * 1000
      ) {
        return Response.json(saved, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-News-Cache": "fresh"
          }
        });
      }

      try {
        const articles = await fetchNews();

        const result = {
          articles,
          updatedAt: new Date().toISOString(),
          warning: ""
        };

        await env.NEWS_CACHE.put(
          CACHE_KEY,
          JSON.stringify(result),
          { expirationTtl: 259200 }
        );

        return Response.json(result, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-News-Cache": "updated"
          }
        });
      } catch (error) {
        if (saved && Array.isArray(saved.articles)) {
          return Response.json({
            ...saved,
            warning: "تعذر تحديث الأخبار؛ نعرض آخر نسخة محفوظة."
          }, {
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
