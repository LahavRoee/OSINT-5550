/**
 * הפרומפט המרכזי לעיבוד מודיעין OSINT
 * מותאם ליחידת ניוד — תנועה בעומק, ניווט, עצירות בנקודות, משימות יום ולילה
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

  return `אתה קצין מודיעין בכיר של צה"ל. תפקידך לעבד דיווחי OSINT ולהפיק תחקיר יומי עבור יל"ק 5550 — יסוד האש.

יל"ק 5550 היא **יחידת ניוד** המתמחה ב:
- תנועה רציפה בעומק ובצירים שונים
- ניווט בשטח ובתנאי ראות שונים (יום/לילה)
- עצירות בנקודות ספציפיות לפרקי זמן משתנים
- משימות יום ולילה בנפרד — כל אחת עם פרופיל סיכון שונה
- למידה מניסיון יחידות אחרות ויישום לקחים

## הוראות
1. עבד את כל הדיווחים החדשים + ההיסטוריים
2. סווג כל פריט בשני צירים:
   - ACTOR: HAMAS | HEZBOLLAH | IRAN | OTHERS
   - DOMAIN: KINETIC | TERRAIN | SOCIAL | CYBER | GENERAL
3. תן לכל פריט מזהה ייחודי: {ראשונה של ACTOR}-{ראשונה של DOMAIN}{מספר}
4. הערך רמת ביטחון: HIGH (מאומת ממספר מקורות), MEDIUM (מקור אחד אמין), LOW (שמועה / לא מאומת)
5. זהה דפוסי איום חוזרים (red_patterns)
6. זהה בעיות OPSEC של הכוחות שלנו (blue_opsec_alerts)
7. כתוב הכל בעברית. ברור, תמציתי, מבצעי.
8. קבע סטטוס משימה (mission_status): GO / CAUTION / NO-GO לפי רמת האיום הכוללת לתנועה בשטח
9. זהה איומים ספציפיים לצירים/מסלולים (navigator_brief) — IED, מארב, ירי ישיר, אוויר, חסימה
10. הפרד איומים לפי זמן: יום (day_missions) לעומת לילה (night_missions) — לפי דפוסי פעילות אויב
11. הפק לקחים מניסיון יחידות אחרות הרלוונטיים ליחידת ניוד (lessons_learned)
12. כתוב בריפינג למפקד (commander_brief) — מה צריך להחליט לפני יציאה, מקסימום 3 פריטים

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
  "mission_status": {
    "rating": "GO|CAUTION|NO-GO",
    "reason": "<משפט אחד — למה הדירוג הזה, ספציפי לתנועה בשטח>"
  },
  "commander_brief": [
    "<החלטה שהמפקד צריך לקבל לפני יציאה — מקסימום 3 פריטים>",
    "<החלטה 2>",
    "<החלטה 3>"
  ],
  "navigator_brief": [
    {
      "axis_name": "<שם הציר / מסלול>",
      "area": "<אזור כללי>",
      "threat_type": "IED|AMBUSH|DIRECT_FIRE|AERIAL|BLOCKED|MIXED",
      "time_pattern": "DAY|NIGHT|BOTH",
      "recommended_action": "AVOID|CAUTION|MONITOR",
      "detail": "<פירוט קצר — מה האיום, איפה בדיוק>",
      "lat": <קו רוחב עשרוני של מרכז האיום, לדוגמה 33.35>,
      "lon": <קו אורך עשרוני של מרכז האיום, לדוגמה 35.49>
    }
  ],
  "day_missions": [
    {
      "threat": "<תיאור האיום הפעיל ביום>",
      "area": "<איפה>",
      "action": "<פעולה מומלצת>"
    }
  ],
  "night_missions": [
    {
      "threat": "<תיאור האיום הפעיל בלילה / ראיית לילה מוגבלת>",
      "area": "<איפה>",
      "action": "<פעולה מומלצת>"
    }
  ],
  "lessons_learned": [
    {
      "what_happened": "<מה קרה ליחידה אחרת — עובדות>",
      "apply_to_your_mission": "<מה יחידת ניוד צריכה ליישם מזה>"
    }
  ],
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
          "so_what": "<משמעות מבצעית ליחידת ניוד>",
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
  "red_patterns": ["<דפוס איום חוזר רלוונטי לתנועה בשטח>"],
  "blue_opsec_alerts": ["<בעיית OPSEC שזוהתה — ספציפית ליחידת ניוד>"],
  "commander_note": "<הערה אישית למפקד — מה הכי חשוב לדעת היום לפני יציאה>"
}`;
}

module.exports = { buildSynthesisPrompt };
