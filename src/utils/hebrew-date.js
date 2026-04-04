/**
 * Hebrew date utilities for OSINT reports
 */

const EN_MONTHS = [
  '', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

const HEBREW_MONTHS = [
  '', 'ניסן', 'אייר', 'סיוון', 'תמוז', 'אב', 'אלול',
  'תשרי', 'חשוון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר ב׳'
];

const HEBREW_DAYS = [
  '', 'א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳', 'ח׳', 'ט׳',
  'י׳', 'י״א', 'י״ב', 'י״ג', 'י״ד', 'ט״ו', 'ט״ז', 'י״ז', 'י״ח', 'י״ט',
  'כ׳', 'כ״א', 'כ״ב', 'כ״ג', 'כ״ד', 'כ״ה', 'כ״ו', 'כ״ז', 'כ״ח', 'כ״ט', 'ל׳'
];

function gematriaYear(year) {
  // Convert Hebrew year to gematria (e.g., 5786 → תשפ״ו)
  const thousands = Math.floor(year / 1000);
  const hundreds = Math.floor((year % 1000) / 100);
  const tens = Math.floor((year % 100) / 10);
  const ones = year % 10;

  const thousandsLetters = ['', 'א', 'ב', 'ג', 'ד', 'ה'];
  const hundredsLetters = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
  const tensLetters = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const onesLetters = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];

  // Skip the thousands (ה), just use the remainder
  let result = hundredsLetters[hundreds] + tensLetters[tens] + onesLetters[ones];

  // Handle special cases: 15 = ט״ו, 16 = ט״ז
  if (tens === 1 && ones === 5) {
    result = hundredsLetters[hundreds] + 'טו';
  } else if (tens === 1 && ones === 6) {
    result = hundredsLetters[hundreds] + 'טז';
  }

  // Add gershayim before last letter
  if (result.length > 1) {
    result = result.slice(0, -1) + '״' + result.slice(-1);
  } else if (result.length === 1) {
    result = result + '׳';
  }

  return result;
}

/**
 * Simple Gregorian to Hebrew date converter
 * Uses algorithmic conversion
 */
function gregorianToHebrew(year, month, day) {
  // Use the hebcal library
  try {
    const { HDate } = require('@hebcal/core');
    const hd = new HDate(new Date(year, month - 1, day));
    return {
      day: hd.getDate(),
      month: hd.getMonth(),
      year: hd.getFullYear(),
      dayStr: HEBREW_DAYS[hd.getDate()] || String(hd.getDate()),
      monthStr: HEBREW_MONTHS[hd.getMonth()] || String(hd.getMonth()),
      yearStr: gematriaYear(hd.getFullYear()),
      formatted: `${HEBREW_DAYS[hd.getDate()] || hd.getDate()} ${HEBREW_MONTHS[hd.getMonth()] || hd.getMonth()} ${gematriaYear(hd.getFullYear())}`,
    };
  } catch {
    // Fallback: use hebcal npm package
    try {
      const Hebcal = require('hebcal');
      const hd = new Hebcal.HDate(new Date(year, month - 1, day));
      const hDay = hd.getDate();
      const hMonth = hd.getMonth();
      const hYear = hd.getFullYear();
      return {
        day: hDay,
        month: hMonth,
        year: hYear,
        dayStr: HEBREW_DAYS[hDay] || String(hDay),
        monthStr: HEBREW_MONTHS[hMonth] || String(hMonth),
        yearStr: gematriaYear(hYear),
        formatted: `${HEBREW_DAYS[hDay] || hDay} ${HEBREW_MONTHS[hMonth] || hMonth} ${gematriaYear(hYear)}`,
      };
    } catch {
      // Last fallback: approximate calculation
      return fallbackHebrewDate(year, month, day);
    }
  }
}

function fallbackHebrewDate(year, month, day) {
  // Rough approximation - Hebrew year ≈ Gregorian + 3760
  const hYear = year + 3760;
  // This is approximate - for production use a real library
  return {
    day: day,
    month: month,
    year: hYear,
    dayStr: HEBREW_DAYS[day] || String(day),
    monthStr: HEBREW_MONTHS[month] || String(month),
    yearStr: gematriaYear(hYear),
    formatted: `${HEBREW_DAYS[day] || day} ${HEBREW_MONTHS[month] || month} ${gematriaYear(hYear)}`,
  };
}

function getHebrewDateString(dateStr) {
  // dateStr: YYYY-MM-DD or DD/MM/YYYY
  let year, month, day;
  if (dateStr.includes('-')) {
    [year, month, day] = dateStr.split('-').map(Number);
  } else {
    [day, month, year] = dateStr.split('/').map(Number);
  }
  const heb = gregorianToHebrew(year, month, day);
  return heb.formatted;
}

function getGregorianDateString(dateStr) {
  let year, month, day;
  if (dateStr.includes('-')) {
    [year, month, day] = dateStr.split('-').map(Number);
  } else {
    [day, month, year] = dateStr.split('/').map(Number);
  }
  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const monthNames = ['', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const d = new Date(year, month - 1, day);
  const dayName = dayNames[d.getDay()];
  return `יום ${dayName}, ${day} ${monthNames[month]} ${year}`;
}

function getDisplayDateString(dateStr) {
  // Returns "04-APRIL-2026"
  let year, month, day;
  if (dateStr.includes('-')) {
    [year, month, day] = dateStr.split('-').map(Number);
  } else {
    [day, month, year] = dateStr.split('/').map(Number);
  }
  const dd = String(day).padStart(2, '0');
  return `${dd}-${EN_MONTHS[month]}-${year}`;
}

function getBothDates(dateStr) {
  return {
    gregorian: getGregorianDateString(dateStr),
    hebrew: getHebrewDateString(dateStr),
    display: getDisplayDateString(dateStr),
  };
}

module.exports = { getHebrewDateString, getGregorianDateString, getDisplayDateString, getBothDates };
