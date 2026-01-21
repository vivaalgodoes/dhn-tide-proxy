const fs = require('fs');
const pdfParse = require('pdf-parse');

const inputFile = 'ilheus-2026.pdf';
const outputFile = 'ilheus-2026.json';

async function extractTideData() {
  try {
    console.log('Reading PDF file...');
    const dataBuffer = fs.readFileSync(inputFile);
    const data = await pdfParse(dataBuffer);
    const text = data.text;
    console.log('PDF text extracted.');

    // Assuming Brazilian Navy tide tables have a specific format:
    // Dates like "01 JAN" followed by tide data lines like "06:30 1.5 H" or "12:45 0.8 L"
    // This is a simplified parser; adjust regex based on actual PDF structure.
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    const tideData = {
      location: 'Ilhéus',
      year: 2026,
      timezone: 'America/Bahia',
      days: []
    };

    let currentDate = null;
    let currentDay = null;

    for (const line of lines) {
      // Match date lines, e.g., "01 JAN"
      const dateMatch = line.match(/^(\d{2})\s+([A-Z]{3})$/);
      if (dateMatch) {
        const day = dateMatch[1];
        const month = dateMatch[2];
        const monthMap = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
                           JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
        const monthNum = monthMap[month];
        if (monthNum) {
          currentDate = `2026-${monthNum}-${day.padStart(2, '0')}`;
          currentDay = { dateKey: currentDate, extremes: [] };
          tideData.days.push(currentDay);
          console.log(`Processing date: ${currentDate}`);
        }
        continue;
      }

      // Match tide extremes, e.g., "06:30 1.5 H" or "12:45 0.8 L"
      const tideMatch = line.match(/^(\d{2}:\d{2})\s+([\d.]+)\s+([HL])$/);
      if (tideMatch && currentDay) {
        const time = tideMatch[1];
        const height = parseFloat(tideMatch[2]);
        const type = tideMatch[3] === 'H' ? 'high' : 'low';
        currentDay.extremes.push({ time, height, type });
      }
    }

    // Sort days by date
    tideData.days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    console.log('Writing JSON file...');
    fs.writeFileSync(outputFile, JSON.stringify(tideData, null, 2));
    console.log('JSON file generated successfully.');
  } catch (error) {
    console.error('Error extracting tide data:', error);
  }
}

extractTideData();
