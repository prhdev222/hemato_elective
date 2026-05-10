/**
 * fuzzyMatch.js
 * เทียบเท่า FuzzyMatch.gs — แปลง 1:1 เลย logic เหมือนกันทุกอย่าง
 */

const PREFIXES = [
  'นพ.', 'นพ ', 'พญ.', 'พญ ',
  'คุณหมอ', 'หมอ',
  'Dr.', 'Dr ', 'dr.', 'dr ',
  'นายแพทย์', 'แพทย์หญิง',
];

export function normalizeName(text) {
  if (!text) return '';
  let s = String(text).trim();
  for (const p of PREFIXES) {
    if (s.toLowerCase().startsWith(p.toLowerCase())) {
      s = s.slice(p.length).trim();
      break;
    }
  }
  return s.replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (!a) return b?.length ?? 0;
  if (!b) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b[i-1] === a[j-1]
        ? m[i-1][j-1]
        : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
    }
  }
  return m[b.length][a.length];
}

function similarity(a, b) {
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const max  = Math.max(a.length, b.length);
  return max === 0 ? 100 : Math.round(((max - dist) / max) * 10000) / 100;
}

/** ให้คะแนนจากชื่อที่ normalize แล้ว (0 = ไม่เข้าข่ายพอจะเลือกเป็น best) */
function scoreAgainstNormalizedNames(normInput, normName) {
  if (!normName) return 0;

  if (normInput === normName) return 100;
  if (normInput.replace(/\s/g,'') === normName.replace(/\s/g,'')) return 100;

  const inputNoSpace = normInput.replace(/\s/g, '');
  const nameNoSpace = normName.replace(/\s/g, '');
  if (
    inputNoSpace.length >= 2 &&
    (nameNoSpace.includes(inputNoSpace) || inputNoSpace.includes(nameNoSpace))
  ) {
    return inputNoSpace === nameNoSpace ? 100 : 95;
  }

  return similarity(normInput, normName);
}

// เทียบเท่า findDoctorByName() ใน FuzzyMatch.gs — รองรับทั้ง name และ name_en (bilingual elective)
export function findDoctorByName(input, doctors, threshold = 90) {
  // อนุญาตให้ค้นหาสั้นลง (เช่น ชื่อเล่น 2 ตัวอักษร) แต่ยังกันคำสั้นเกินไป
  if (!input?.trim() || input.trim().length < 2) return null;

  const normInput = normalizeName(input);
  if (normInput.length < 2) return null;

  let best = null;
  let bestScore = 0;

  for (const doc of doctors) {
    const variants = [];
    if (doc.name != null && String(doc.name).trim()) variants.push(doc.name);
    if (doc.name_en != null && String(doc.name_en).trim()) variants.push(doc.name_en);
    let docBest = 0;

    for (const raw of variants) {
      const normName = normalizeName(raw);
      const score = scoreAgainstNormalizedNames(normInput, normName);
      if (score === 100) return { doctor: doc, similarity: 100 };
      if (score > docBest) docBest = score;
    }

    if (docBest > bestScore) {
      bestScore = docBest;
      best = doc;
    }
  }

  return bestScore >= threshold ? { doctor: best, similarity: bestScore } : null;
}
