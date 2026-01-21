const BUILD_ID = "build-2026-01-20-02";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(`ok ${BUILD_ID}`, { status: 200 });
    }

    if (url.pathname === "/dhn/ilheus/week") {
      try {
        const start = url.searchParams.get("start"); // YYYY-MM-DD (opcional)
        const startDate = start ? start : getBahiaDateKey(new Date());

        // ✅ NOVO: baixa o JSON do GitHub em vez do PDF
        const jsonUrl = "https://raw.githubusercontent.com/vivaalgodoes/dhn-tide-proxy/main/ilheus-2026.json";
        const resp = await fetch(jsonUrl);
        if (!resp.ok) throw new Error(`JSON falhou: ${resp.status}`);
        const data = await resp.json();

        // ✅ NOVO: filtra os dados para a semana solicitada
        const payload = buildWeekFromJsonData(data, startDate, jsonUrl);

        return json(payload);
      } catch (err) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: String(err?.message || err),
            stack: String(err?.stack || ""),
            buildId: BUILD_ID
          }),
          {
            status: 500,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "access-control-allow-origin": "*",
            },
          }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

function pad2(n) { return String(n).padStart(2, "0"); }

function getBahiaDateKey(date) {
  // Worker roda em UTC; forçamos Bahia (UTC-03) simplificado
  const ms = date.getTime() - (3 * 60 * 60 * 1000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDaysToDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`;
}

function buildWeekFromJsonData(jsonData, startDateKey, jsonUrl) {
  // ✅ NOVO: assume que jsonData é um array de objetos com { dateKey, extremes }
  // Filtra apenas os dias da semana solicitada
  const weekKeys = [];
  for (let i = 0; i < 7; i++) weekKeys.push(addDaysToDateKey(startDateKey, i));

  const days = jsonData.filter(d => weekKeys.includes(d.dateKey));

  // Monta flatExtremes
  const flatExtremes = days.flatMap(d => d.extremes || []);

  return {
    source: "DHN/CHM",
    sourceName: "Marinha do Brasil - CHM (Tábua de Marés)",
    sourceJsonUrl: jsonUrl,
    startDateKey: startDateKey,
    days,
    flatExtremes
  };
}
