export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // Retorna semana de maré (JSON) já pronto para o Wix
    if (url.pathname === "/dhn/ilheus/week") {
      try {
        const start = url.searchParams.get("start"); // YYYY-MM-DD (opcional)
        const startDate = start ? start : getBahiaDateKey(new Date());

        // 1) Descobre PDF atual no índice
        const pdfUrl = await discoverIlheusPdfUrl();

        // 2) Baixa PDF
        const pdfBytes = await fetchPdfBytes(pdfUrl);

        // 3) Extrai texto do PDF (via pdf.js em Worker? -> não é viável direto)
        // ✅ Estratégia robusta: usar um serviço de conversão *dentro do Worker* via endpoint público
        // Mas o ideal é: usar PDF text extractor em JS puro não é simples no Worker.
        // Então, para Cloudflare, a forma mais estável é:
        // - usar um endpoint de conversão (ex.: pdf2text) OU
        // - usar um modelo de PDF que já contém texto legível e extrair por regex dos bytes (muitas vezes funciona)

        const rawText = bytesToLatin1String(pdfBytes);
        const normalized = normalizeSpaces(rawText);

        const payload = buildWeekFromDhnText(normalized, startDate, pdfUrl);

        return json(payload);
      } catch (err) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: String(err?.message || err),
            stack: String(err?.stack || ""),
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

function normalizeSpaces(s) {
  return String(s || "")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n");
}

function bytesToLatin1String(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const max = Math.min(bytes.length, 2500000);
  let s = "";
  for (let i = 0; i < max; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function normalizeTextForSearch(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
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

// DHN Ilhéus: UTC-03
const LOCAL_TZ_OFFSET_MINUTES = -3 * 60;

function dateKeyToUtcIsoFromLocalHHMM(dateKey, hhmm) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const hh = Number(hhmm.slice(0, 2));
  const mm = Number(hhmm.slice(2, 4));
  const localAsUtcMs = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  const utcMs = localAsUtcMs - (LOCAL_TZ_OFFSET_MINUTES * 60 * 1000);
  return new Date(utcMs).toISOString();
}

const INDEX_URL = "https://www.marinha.mil.br/chm/tabuas-de-mare-6";
const TARGET_LABEL = "PORTO DE ILHÉUS";

async function discoverIlheusPdfUrl() {
  const resp = await fetch(INDEX_URL, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8"
    }
  });

  if (!resp.ok) throw new Error(`Índice DHN falhou: ${resp.status}`);

  const html = await resp.text();
  const links = [];
  const re = /href\s*=\s*"([^"]+\.pdf[^"]*)"/gi;
  let m = null;
  while ((m = re.exec(html)) !== null) links.push(m[1]);

  const pdfUrls = links
    .map((href) => {
      if (href.startsWith("http")) return href;
      if (href.startsWith("/")) return `https://www.marinha.mil.br${href}`;
      return `https://www.marinha.mil.br/${href}`;
    });

  const target = pdfUrls.find((u) => normalizeTextForSearch(u).includes(normalizeTextForSearch(TARGET_LABEL)));
  if (!target) throw new Error("PDF de Ilhéus não encontrado no índice DHN.");
  return target;
}

async function fetchPdfBytes(pdfUrl) {
  const resp = await fetch(pdfUrl, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "application/pdf,*/*"
    }
  });
  if (!resp.ok) throw new Error(`PDF DHN falhou: ${resp.status}`);
  return await resp.arrayBuffer();
}

const MONTH_NAMES = [
  null,
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
];

function sliceMonthBlock(fullText, monthNumber) {
  const name = MONTH_NAMES[monthNumber];
  if (!name) return null;

  const next = monthNumber === 12 ? null : MONTH_NAMES[monthNumber + 1];

  const hay = normalizeTextForSearch(fullText);
  const needle = normalizeTextForSearch(name);

  const idxStart = hay.indexOf(needle);
  if (idxStart < 0) return null;

  if (!next) return fullText.slice(idxStart);

  const nextNeedle = normalizeTextForSearch(next);
  const idxEnd = hay.indexOf(nextNeedle, idxStart + needle.length);

  if (idxEnd < 0) return fullText.slice(idxStart);
  return fullText.slice(idxStart, idxEnd);
}

function parseDayPairsFromText(text) {
  const pairRe = /\b(\d{4})\s+(-?\d+(?:\.\d+))\b/g;
  const lineRe = /^\s*(\d{1,2})\s+([A-ZÇ]{3})?\s*(.*)$/;

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const map = new Map();

  for (const line of lines) {
    const m = line.match(lineRe);
    if (!m) continue;

    const day = Number(m[1]);
    if (!(day >= 1 && day <= 31)) continue;

    const rest = m[3] || "";
    let pm = null;
    const pairs = [];

    while ((pm = pairRe.exec(rest)) !== null) {
      pairs.push({ hhmm: pm[1], height: Number(pm[2]) });
    }

    if (pairs.length) {
      const prev = map.get(day) || [];
      map.set(day, prev.concat(pairs));
    }
  }

  // dedup/ordena
  for (const [day, pairs] of map.entries()) {
    const unique = new Map();
    for (const p of pairs) unique.set(`${p.hhmm}|${p.height}`, p);
    const arr = Array.from(unique.values()).sort((a, b) => a.hhmm.localeCompare(b.hhmm));
    map.set(day, arr);
  }

  return map;
}

function getPairsForDateKey(fullText, dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const block = sliceMonthBlock(fullText, m);
  if (!block) return [];
  const map = parseDayPairsFromText(block);
  return map.get(d) || [];
}

function classifyHighLowByNeighbors(events) {
  const sorted = events.slice().sort((a, b) => new Date(a.time) - new Date(b.time));
  if (sorted.length === 0) return [];
  if (sorted.length === 1) return [{ ...sorted[0], type: "high" }];

  if (sorted.length === 2) {
    const a = sorted[0], b = sorted[1];
    if (a.height === b.height) return [{ ...a, type: "low" }, { ...b, type: "high" }];
    const firstIsHigh = a.height > b.height;
    return [{ ...a, type: firstIsHigh ? "high" : "low" }, { ...b, type: firstIsHigh ? "low" : "high" }];
  }

  return sorted.map((e, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    if (!prev && next) return { ...e, type: e.height >= next.height ? "high" : "low" };
    if (prev && !next) return { ...e, type: e.height >= prev.height ? "high" : "low" };

    if (prev && next) {
      if (e.height > prev.height && e.height > next.height) return { ...e, type: "high" };
      if (e.height < prev.height && e.height < next.height) return { ...e, type: "low" };
      const up = e.height - prev.height;
      const down = next.height - e.height;
      return { ...e, type: (up >= 0 && down <= 0) ? "high" : "low" };
    }
    return { ...e, type: "high" };
  });
}

function buildWeekFromDhnText(fullText, startDateKey, pdfUrl) {
  const weekKeys = [];
  for (let i = 0; i < 7; i++) weekKeys.push(addDaysToDateKey(startDateKey, i));

  const days = weekKeys.map((dk) => {
    const pairs = getPairsForDateKey(fullText, dk);

    const events = pairs.map((p) => ({
      time: dateKeyToUtcIsoFromLocalHHMM(dk, p.hhmm),
      height: p.height
    }));

    const typed = classifyHighLowByNeighbors(events);
    return { dateKey: dk, extremes: typed };
  });

  const flatExtremes = days.flatMap(d => d.extremes);

  return {
    source: "DHN/CHM",
    sourceName: "Marinha do Brasil - CHM (Tábua de Marés)",
    sourcePdfUrl: pdfUrl,
    startDateKey: startDateKey,
    days,
    flatExtremes
  };
}
