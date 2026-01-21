import pdfplumber
import json
import re
from datetime import datetime, timedelta

# ⚠️ Caminho ajustado para o seu Mac (substitua se o arquivo estiver em outro lugar)
PDF_PATH = "/Users/danielchagas/Downloads/Data_Ilheus.pdf"

# Funções auxiliares (igual ao Worker)
def normalize_spaces(s):
    return str(s or "").replace('\u0000', ' ').replace('\t', ' ').replace('\r', '\n').replace('\n{2,}', '\n')

def bytes_to_latin1_string(array_buffer):
    bytes_data = array_buffer
    max_len = min(len(bytes_data), 2500000)
    return ''.join(chr(b) for b in bytes_data[:max_len])

def get_bahia_date_key(date):
    # Bahia UTC-03
    ms = date.timestamp() * 1000 - (3 * 60 * 60 * 1000)
    d = datetime.fromtimestamp(ms / 1000)
    return f"{d.year}-{d.month:02d}-{d.day:02d}"

def date_key_to_utc_iso_from_local_hhmm(date_key, hhmm):
    y, m, d = map(int, date_key.split('-'))
    hh, mm = int(hhmm[:2]), int(hhmm[2:])
    local_ms = datetime(y, m, d, hh, mm).timestamp() * 1000
    utc_ms = local_ms - (3 * 60 * 60 * 1000)  # Bahia UTC-03
    return datetime.fromtimestamp(utc_ms / 1000).isoformat() + 'Z'

def classify_high_low_by_neighbors(events):
    sorted_events = sorted(events, key=lambda e: e['time'])
    if not sorted_events:
        return []
    if len(sorted_events) == 1:
        return [{**sorted_events[0], 'type': 'high'}]
    if len(sorted_events) == 2:
        a, b = sorted_events
        if a['height'] == b['height']:
            return [{**a, 'type': 'low'}, {**b, 'type': 'high'}]
        first_is_high = a['height'] > b['height']
        return [{**a, 'type': 'high' if first_is_high else 'low'}, {**b, 'type': 'low' if first_is_high else 'high'}]
    
    return [
        {**e, 'type': 'high' if (prev is None and e['height'] >= next_e['height']) or (next_e is None and e['height'] >= prev['height']) or (prev and next_e and e['height'] > prev['height'] and e['height'] > next_e['height']) else 'low'}
        for i, e in enumerate(sorted_events)
        for prev in [sorted_events[i-1] if i > 0 else None]
        for next_e in [sorted_events[i+1] if i &lt; len(sorted_events)-1 else None]
    ]

# Extrair texto do PDF
with pdfplumber.open(PDF_PATH) as pdf:
    full_text = ''
    for page in pdf.pages:
        full_text += page.extract_text() or ''

normalized = normalize_spaces(full_text)

# Parsear dados (adaptado para o formato típico do DHN)
month_names = [None, 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

def slice_month_block(full_text, month_number):
    name = month_names[month_number]
    if not name:
        return None
    next_name = month_names[month_number + 1] if month_number &lt; 12 else None
    hay = full_text.upper()
    needle = name.upper()
    idx_start = hay.find(needle)
    if idx_start &lt; 0:
        return None
    if not next_name:
        return full_text[idx_start:]
    next_needle = next_name.upper()
    idx_end = hay.find(next_needle, idx_start + len(needle))
    return full_text[idx_start:idx_end] if idx_end >= 0 else full_text[idx_start:]

def parse_day_pairs_from_text(text):
    pair_re = re.compile(r'\b(\d{4})\s+(-?\d+(?:\.\d+)?)\b')
    line_re = re.compile(r'^\s*(\d{1,2})\s+([A-ZÇ]{3})?\s*(.*)$')
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    day_map = {}
    for line in lines:
        m = line_re.match(line)
        if not m:
            continue
        day = int(m.group(1))
        if not (1 &lt;= day &lt;= 31):
            continue
        rest = m.group(3) or ''
        pairs = []
        for pm in pair_re.finditer(rest):
            pairs.append({'hhmm': pm.group(1), 'height': float(pm.group(2))})
        if pairs:
            day_map.setdefault(day, []).extend(pairs)
    # Dedup e ordena
    for day, pairs in day_map.items():
        unique = {}
        for p in pairs:
            unique[f"{p['hhmm']}|{p['height']}"] = p
        day_map[day] = sorted(unique.values(), key=lambda p: p['hhmm'])
    return day_map

# Gerar dados para 2026 (ano inteiro)
year = 2026
days_data = []
for month in range(1, 13):
    block = slice_month_block(normalized, month)
    if not block:
        continue
    day_map = parse_day_pairs_from_text(block)
    for day in range(1, 32):
        date_key = f"{year}-{month:02d}-{day:02d}"
        pairs = day_map.get(day, [])
        events = [{'time': date_key_to_utc_iso_from_local_hhmm(date_key, p['hhmm']), 'height': p['height']} for p in pairs]
        typed_events = classify_high_low_by_neighbors(events)
        days_data.append({'dateKey': date_key, 'extremes': typed_events})

# Salvar JSON
output = {
    'location': 'Ilhéus',
    'year': year,
    'timezone': 'America/Bahia',
    'days': days_data
}

with open('ilheus-2026.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print("✅ JSON gerado: ilheus-2026.json")
