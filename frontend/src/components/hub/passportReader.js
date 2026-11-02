// Reads the machine-readable zone (the two lines of <<< at the bottom) of a
// passport photo, in the browser. The image never leaves the device for this:
// text recognition (Tesseract) runs locally; only the code is loaded from a CDN.
// Results are suggestions the user must confirm.

const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_SRC;
      s.async = true;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { loading = null; reject(new Error('Could not load the passport reader')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const charValue = (c) => {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
  return 0; // '<'
};
export function mrzCheck(str) {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < str.length; i += 1) sum += charValue(str[i]) * w[i % 3];
  return String(sum % 10);
}

function yymmdd(s, future) {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = Number(s.slice(0, 2)); const mm = s.slice(2, 4); const dd = s.slice(4, 6);
  const nowYY = new Date().getFullYear() % 100;
  let century;
  if (future) century = 2000; // expiry dates
  else century = yy > nowYY ? 1900 : 2000; // birth dates
  return `${century + yy}-${mm}-${dd}`;
}

// Fix common OCR confusions inside numeric MRZ positions
const digits = (s) => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');

/** Parse TD3 (passport) MRZ lines. Returns null when nothing usable was found. */
export function parseMrz(text) {
  const lines = String(text || '').toUpperCase().split(/\n/)
    .map((l) => l.replace(/\s+/g, '').replace(/[«‹]/g, '<').replace(/[^A-Z0-9<]/g, ''))
    .filter((l) => l.length >= 30);
  const i = lines.findIndex((l) => l.startsWith('P'));
  if (i < 0 || !lines[i + 1]) return null;
  const l1 = lines[i].padEnd(44, '<').slice(0, 44);
  const l2 = lines[i + 1].padEnd(44, '<').slice(0, 44);
  const country = l1.slice(2, 5).replace(/</g, '');
  const [surname, given = ''] = l1.slice(5).split('<<');
  const number = l2.slice(0, 9).replace(/</g, '');
  const birthRaw = digits(l2.slice(13, 19));
  const expRaw = digits(l2.slice(21, 27));
  const out = {
    issuing_country: country,
    nationality: l2.slice(10, 13).replace(/</g, ''),
    last_name: surname.replace(/</g, ' ').trim(),
    first_name: given.replace(/</g, ' ').trim(),
    passport_number: number,
    birth_date: yymmdd(birthRaw, false),
    expiry_date: yymmdd(expRaw, true),
    checks: {
      number: mrzCheck(l2.slice(0, 9)) === digits(l2[9]),
      birth: mrzCheck(birthRaw) === digits(l2[19]),
      expiry: mrzCheck(expRaw) === digits(l2[27]),
    },
  };
  if (!out.birth_date && !out.expiry_date && !out.last_name) return null;
  return out;
}

const titleCase = (s) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Run OCR on an image File/Blob/URL and return parsed passport data. */
export async function readPassport(image, onProgress) {
  const T = await loadTesseract();
  const res = await T.recognize(image, 'eng', {
    logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100)); },
  });
  const parsed = parseMrz(res?.data?.text);
  if (!parsed) return null;
  return {
    ...parsed,
    first_name: parsed.first_name ? titleCase(parsed.first_name) : '',
    last_name: parsed.last_name ? titleCase(parsed.last_name) : '',
  };
}
