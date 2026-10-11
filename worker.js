
const QUERIES = [
  "(Yemen OR اليمن)",
  "(Taiz OR تعز) Yemen"
];

function clean(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function fetchQuery(query) {
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: "50",
    sort: "DateDesc",
    timespan: "3d"
  });

  const response = await fetch(
    "https://api.gdeltproject.org/api/v2/doc/doc?" + params
  );

  if (!response.ok) {
    throw new Error("News source returned " + response.status);
  }

  const data = await response.json();
  return Array.isArray(data.articles) ? data.articles : [];
}

async function getNews() {
  const batches = await Promise.allSettled(
    QUERIES.map(fetchQuery)
  );

  const unique = new Map();

  for (const batch of batches) {
    if (batch.status !== "fulfilled") continue;

    for (const article of batch.value) {
      const url = article.url || article.url_mobile;
      const title = clean(article.title || "");

      if (!url || !title || !/^https?:\/\//i.test(url)) continue;

      const key = url.split("#")[0].split("?")[0];

      if (!unique.has(key)) {
        unique.set(key, {
          title,
          url,
          date: article.seendate
            ? new Date(article.seendate).toISOString()
            : null,
          source: clean(article.source || domainOf(url)),
          domain: domainOf(url),
          summary: clean(
            article.snippet || article.description || ""
          ).slice(0, 260)
        });
      }
    }
  }

  const articles = [...unique.values()]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 70);

  return {
    articles,
    updatedAt: new Date().toISOString(),
    warning: batches.every(x => x.status === "rejected")
      ? "لم تستجب خدمة الأخبار الخارجية."
      : ""
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/news" && request.method === "GET") {
      try {
        const data = await getNews();

        return Response.json(data, {
          headers: {
            "Cache-Control": "public, max-age=180",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch {
        return Response.json(
          {
            articles: [],
            warning: "تعذر جلب الأخبار من المصدر الخارجي مؤقتًا."
          },
          {
            headers: { "Cache-Control": "no-store" }
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
