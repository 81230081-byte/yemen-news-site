
async function fetchNews() {
  const params = new URLSearchParams({
    query: "Yemen",
    mode: "artlist",
    format: "json",
    maxrecords: "50",
    timespan: "3d"
  });

  const response = await fetch(
    "https://api.gdeltproject.org/api/v2/doc/doc?" + params
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error("GDELT HTTP " + response.status);
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("GDELT returned non-JSON: " + body.slice(0, 180));
  }

  if (!Array.isArray(data.articles)) {
    throw new Error("GDELT response has no articles array");
  }

  return data.articles.map(article => {
    const rawDate = article.seendate || "";
    let date = null;

    const match = rawDate.match(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/
    );

    if (match) {
      date = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
    }

    let domain = article.domain || "";
    try {
      domain = new URL(article.url).hostname.replace(/^www\./, "");
    } catch {}

    return {
      title: article.title || "بدون عنوان",
      url: article.url || "",
      date,
      source: domain,
      domain,
      summary: "",
      language: article.language || ""
    };
  }).filter(article => article.url && article.title);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/news" && request.method === "GET") {
      try {
        const articles = await fetchNews();

        return Response.json({
          articles,
          updatedAt: new Date().toISOString(),
          warning: articles.length
            ? ""
            : "لم يعثر المصدر على أخبار خلال الفترة المحددة."
        }, {
          headers: {
            "Cache-Control": "public, max-age=180"
          }
        });
      } catch (error) {
        return Response.json({
          articles: [],
          warning: "تعذر جلب الأخبار الخارجية.",
          diagnostic: String(error.message || error)
        }, {
          status: 502,
          headers: { "Cache-Control": "no-store" }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
