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

// เทียบเท่า findDoctorByName() ใน FuzzyMatch.gs
export function findDoctorByName(input, doctors, threshold = 90) {
  // อนุญาตให้ค้นหาสั้นลง (เช่น ชื่อเล่น 2 ตัวอักษร) แต่ยังกันคำสั้นเกินไป
  if (!input?.trim() || input.trim().length < 2) return null;

  const normInput = normalizeName(input);
  if (normInput.length < 2) return null;

  let best = null, bestScore = 0;

  for (const doc of doctors) {
    const normName = normalizeName(doc.name);
    if (!normName) continue;

    // Exact match → คืนทันที
    if (normInput === normName) return { doctor: doc, similarity: 100 };

    // No-space match
    if (normInput.replace(/\s/g,'') === normName.replace(/\s/g,'')) {
      return { doctor: doc, similarity: 100 };
    }

    // Partial match: รองรับการพิมพ์เฉพาะชื่อหน้า/ชื่อเล่น
    // เช่น input "ใจเย็น" match กับ "ใจเย็น ใจดี"
    const inputNoSpace = normInput.replace(/\s/g, '');
    const nameNoSpace = normName.replace(/\s/g, '');
    if (
      inputNoSpace.length >= 2 &&
      (nameNoSpace.includes(inputNoSpace) || inputNoSpace.includes(nameNoSpace))
    ) {
      const score = inputNoSpace === nameNoSpace ? 100 : 95;
      if (score > bestScore) { bestScore = score; best = doc; }
      continue;
    }

    // Levenshtein
    const score = similarity(normInput, normName);
    if (score > bestScore) { bestScore = score; best = doc; }
  }

  return bestScore >= threshold ? { doctor: best, similarity: bestScore } : null;
}
