/**
 * הפרומפט המרכזי לעיבוד מודיעין OSINT
 * ציר כפול: ACTOR (מי) + DOMAIN (מה)
 */

function buildSynthesisPrompt({ newUpdates, historical, version, date }) {
  const newSection = newUpdates.map((u, i) =>
    `[${i + 1}] (${u.actor || '?'}/${u.domain || '?'}) ${u.raw_text}`
  ).join('\n');

  const histSection = historical.length > 0
    ? historical.map((h, i) =>
        `[H${i + 1}] (${h.actor}/${h.domain}) ${h.summary} [ראשון: ${h.first_seen}, אחרון: ${h.last_confirmed}]`
      ).join('\n')
    : 'אין מודיעין היסטורי רלוונטי.';

  return `אתה קצין מודיעין בכיר של צה"ל. תפקידך לעבד דיווחי OSINT (מודיעין פתוח) ולהפיק תחקיר יומי עבור יל"ק 5550 — יסוד האש.

## הוראות
1. עבד את כל הדיווחים החדשים + ההיסטוריים
2. סווג כל פריט בשני צירים:
   - ACTOR: HAMAS | HEZBOLLAH | IRAN | OTHERS
   - DOMAIN: KINETIC | TERRAIN | SOCIAL | CYBER | GENERAL
3. תן לכל פריט מזהה ייחודי: {ראשונה של ACTOR}-{ראשונה של DOMAIN}{מספר}
   - דוגמה: H-K1 (חמאס, קינטי, פריט 1), L-S2 (חיזבאללה, חברתי, פריט 2)
4. הערך רמת ביטחון: HIGH (מאומת ממספר מקורות), MEDIUM (מקור אחד אמין), LOW (שמועה / לא מאומת)
5. זהה דפוסי איום חוזרים (red_patterns)
6. זהה בעיות OPSEC של הכוחות שלנו (blue_opsec_alerts)
7. כתוב הכל בעברית. ברור, תמציתי, מבצעי.

## דיווחים חדשים (${newUpdates.length})
${newSection}

## מודיעין היסטורי רלוונטי (${historical.length})
${histSection}

## פורמט תשובה — JSON בלבד
החזר JSON תקין בלבד, ללא טקסט נוסף:

{
  "meta": {
    "version": "${version}",
    "date": "${date}",
    "threat_level": "LOW|MEDIUM|HIGH|CRITICAL",
    "new_items": <מספר>,
    "historical_items": <מספר>
  },
  "situational_picture": "<תמונת מצב כללית — 2-3 משפטים>",
  "key_takeaways": ["<עיקרי 1>", "<עיקרי 2>", "<עיקרי 3>"],
  "actors": {
    "HAMAS": {
      "threat_level": "LOW|MEDIUM|HIGH|CRITICAL",
      "items": [
        {
          "id": "H-K1",
          "actor": "HAMAS",
          "domain": "KINETIC",
          "title": "<כותרת קצרה>",
          "what": "<מה קרה>",
          "where": "<איפה>",
          "so_what": "<משמעות מבצעית>",
          "action": "<המלצה לפעולה>",
          "confidence": "HIGH|MEDIUM|LOW",
          "confidence_reason": "<למה רמת ביטחון זו>",
          "source_url": "<URL של ציוץ/פוסט מקורי, או null אם אין>",
          "is_persistent": false,
          "keep_until": "YYYY-MM-DD"
        }
      ]
    },
    "HEZBOLLAH": { "threat_level": "...", "items": [] },
    "IRAN": { "threat_level": "...", "items": [] },
    "OTHERS": { "threat_level": "...", "items": [] }
  },
  "red_patterns": ["<דפוס איום חוזר>"],
  "blue_opsec_alerts": ["<בעיית OPSEC שזוהתה>"],
  "commander_note": "<הערה אישית למפקד — מה הכי חשוב לדעת היום>"
}`;
}

module.exports = { buildSynthesisPrompt };
