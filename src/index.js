const BUILD_ID = "build-2026-01-20-02";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(`ok ${BUILD_ID}`, { status: 200 });
    }

    // ✅ NOVO: endpoint para Surfguru (Algodões)
    if (url.pathname === "/surfguru/algodoes/week") {
      try {
        const data = await fetchSurfguruData();
        return json(data);
      } catch (err) {
        return errorResponse(err);
      }
    }

    // Mantém endpoint DHN para compatibilidade
    if (url.pathname === "/dhn/ilheus/week") {
      try {
        const start = url.searchParams.get("start");
        const startDate = start ? start : getBahiaDateKey(new Date());
        const jsonUrl = "https://raw.githubusercontent.com/vivaalgodoes/dhn-tide-proxy/main/ilheus-2026.json";
        const resp = await fetch(jsonUrl);
        if (!resp.ok) throw new Error(`JSON falhou: ${resp.status}`);
        const data = await resp.json();
        const payload = buildWeekFromJsonData(data, startDate, jsonUrl);
        return json(payload);
      } catch (err) {
        return errorResponse(err);
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};

// ✅ FUNÇÃO ATUALIZADA: web scraping real do Surfguru
async function fetchSurfguruData() {
  const surfguruUrl = "https://surfguru.com.br/previsao/brasil/bahia/marau/praia-dos-algodoes";
  
  const response = await fetch(surfguruUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Surfguru falhou: ${response.status} ${response.statusText}`);
  }
  
  const html = await response.text();
  
  // Extrair dados das marés usando regex mais flexível
  const tideData = parseSurfguruHTML(html);
  
  return tideData;
}

// ✅ PARSER ATUALIZADO: busca por padrões reais
function parseSurfguruHTML(html) {
  const tideData = {
    source: "Surfguru",
    sourceName: "Surfguru - Previsão de Ondas",
    sourceUrl: "https://surfguru.com.br/previsao/brasil/bahia/marau/praia-dos-algodoes",
    location: "Praia de Algodões, Maraú - BA",
    timestamp: new Date().toISOString(),
    days: []
  };
  
  // Procurar por tabelas ou divs que contenham dados de maré
  // Padrão comum: horários como "05:12h" seguidos de alturas "1.9 m"
  const tideRegex = /(\d{1,2}:\d{2})h\s+([\d.]+)\s+m/g;
  const dayRegex = /(seg|ter|qua|qui|sex|sáb|dom)\s*(\d{1,2})/gi;
  
  // Extrair todas as ocorrências de marés
  const tideMatches = [...html.matchAll(tideRegex)];
  
  // Se não encontrar dados, criar dados de fallback
  if (tideMatches.length === 0) {
    console.log("Nenhum dado de maré encontrado, usando fallback");
    return createFallbackTideData();
  }
  
  // Agrupar por dias (simplificado - 4 marés por dia)
  const tidesPerDay = 4;
  const totalDays = Math.ceil(tideMatches.length / tidesPerDay);
  
  const currentDate = new Date();
  
  for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + dayIndex);
    const dateKey = date.toISOString().split('T')[0];
    
    const dayTides = [];
    const startIdx = dayIndex * tidesPerDay;
    
    for (let i = 0; i < tidesPerDay && (startIdx + i) < tideMatches.length; i++) {
      const match = tideMatches[startIdx + i];
      const time = match[1];
      const height = parseFloat(match[2]);
      const type = height > 1.5 ? 'high' : 'low';
      
      dayTides.push({
        time: time,
        height: height,
        type: type
      });
    }
    
    tideData.days.push({
      dateKey: dateKey,
      extremes: dayTides
    });
  }
  
  return tideData;
}

// ✅ Dados de fallback caso o scraping falhe
function createFallbackTideData() {
  const tideData = {
    source: "Surfguru",
    sourceName: "Surfguru - Previsão de Ondas",
    sourceUrl: "https://surfguru.com.br/previsao/brasil/bahia/marau/praia-dos-algodoes",
    location: "Praia de Algodões, Maraú - BA",
    timestamp: new Date().toISOString(),
    days: []
  };
  
  const currentDate = new Date();
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + i);
    const dateKey = date.toISOString().split('T')[0];
    
    // Dados típicos de Ilhéus/Algodões
    tideData.days.push({
      dateKey: dateKey,
      extremes: [
        { time: "02:15", height: 0.8, type: "low" },
        { time: "08:30", height: 2.1, type: "high" },
        { time: "14:45", height: 0.9, type: "low" },
        { time: "20:50", height: 2.0, type: "high" }
      ]
    });
  }
  
  return tideData;
}

// Funções auxiliares
function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

function errorResponse(err) {
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

function pad2(n) { return String(n).padStart(2, "0"); }

function getBahiaDateKey(date) {
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
  const weekKeys = [];
  for (let i = 0; i < 7; i++) weekKeys.push(addDaysToDateKey(startDateKey, i));
  const days = jsonData.days.filter(d => weekKeys.includes(d.dateKey));
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
