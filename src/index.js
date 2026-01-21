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

// ✅ NOVA FUNÇÃO: extrair dados REAIS do Surfguru
async function fetchSurfguruData() {
  const surfguruUrl = "https://surfguru.com.br/previsao/brasil/bahia/marau/praia-dos-algodoes";
  
  const response = await fetch(surfguruUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare Worker)'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Surfguru falhou: ${response.status}`);
  }
  
  const html = await response.text();
  
  // Extrair dados das marés do HTML
  const tideData = parseSurfguruTideData(html);
  
  return tideData;
}

// ✅ PARSER para dados do Surfguru
function parseSurfguruTideData(html) {
  // Encontrar a seção de marés
  const tideSectionMatch = html.match(/Section Title: previsão > Altura da Maré[\s\S]*?mais dias de previsão/);
  if (!tideSectionMatch) {
    throw new Error("Seção de marés não encontrada no HTML");
  }
  
  const tideSection = tideSectionMatch[0];
  const lines = tideSection.split('\n').map(line => line.trim()).filter(line => line);
  
  const tideData = {
    source: "Surfguru",
    sourceName: "Surfguru - Previsão de Ondas",
    sourceUrl: "https://surfguru.com.br/previsao/brasil/bahia/marau/praia-dos-algodoes",
    location: "Praia de Algodões, Maraú - BA (Porto de Ilhéus)",
    timestamp: new Date().toISOString(),
    days: []
  };
  
  let currentDay = null;
  const currentYear = 2026;
  const monthMap = {
    'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06',
    'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12'
  };
  
  for (const line of lines) {
    // Ignorar linhas irrelevantes
    if (line.includes('porto de ilheus') || line.includes('ontem') || 
        line.includes('mais dias') || line.includes('◄ MOVER ►')) {
      continue;
    }
    
    // Identificar dias: "QUA 21", "QUI 22", etc.
    const dayMatch = line.match(/^([A-Z]{3})\s+(\d{1,2})$/);
    if (dayMatch) {
      const dayName = dayMatch[1]; // QUA, QUI, SEX
      const dayNumber = parseInt(dayMatch[2]);
      
      // Janeiro de 2026 (ajustar conforme mês atual)
      const dateKey = `2026-01-${dayNumber.toString().padStart(2, '0')}`;
      
      currentDay = {
        dateKey: dateKey,
        dayName: dayName,
        extremes: []
      };
      
      tideData.days.push(currentDay);
      continue;
    }
    
    // Extrair dados de marés: "05:12h 1.9 m", "11:10h 0.3 m"
    if (currentDay) {
      const tideMatches = line.matchAll(/(\d{1,2}:\d{2})h\s+([\d.]+)\s+m/g);
      
      for (const match of tideMatches) {
        const time = match[1];
        const height = parseFloat(match[2]);
        
        // Determinar se é alta ou baixa (simplificado: >1.5 = alta)
        const type = height > 1.5 ? 'high' : 'low';
        
        currentDay.extremes.push({
          time: time,
          height: height,
          type: type
        });
      }
    }
  }
  
  // Ordenar por data
  tideData.days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  
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
