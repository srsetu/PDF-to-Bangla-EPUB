/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bengali OCR Accuracy, Unicode Script Validation, Context-Aware Correction,
 * and Selective Image-Based Verification Pipeline.
 */

import {
  BookDetails,
  PageItem,
  OcrTokenRegion,
  OcrCorrectionEntry,
  OcrFlaggedToken,
  OcrValidationReport,
} from '../types';

export type UnicodeScriptName =
  | 'Bengali'
  | 'Devanagari'
  | 'Gurmukhi'
  | 'Gujarati'
  | 'Odia'
  | 'Tamil'
  | 'Telugu'
  | 'Kannada'
  | 'Malayalam'
  | 'Latin'
  | 'Cyrillic'
  | 'Greek'
  | 'Arabic'
  | 'Common';

const INDIC_SCRIPTS: ReadonlySet<UnicodeScriptName> = new Set<UnicodeScriptName>([
  'Devanagari',
  'Gurmukhi',
  'Gujarati',
  'Odia',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
]);

/**
 * Valid assigned codepoints in the Bengali Unicode block (U+0980..U+09FF).
 * Unassigned holes in the U+0980..U+09FF block are excluded.
 */
export function isAssignedBengaliCodepoint(code: number): boolean {
  if (code < 0x0980 || code > 0x09ff) return false;
  // Unassigned codepoints in the Bengali block per Unicode Standard
  if (
    code === 0x0984 ||
    code === 0x098d ||
    code === 0x098e ||
    code === 0x0991 ||
    code === 0x0992 ||
    code === 0x09a9 ||
    code === 0x09b1 ||
    code === 0x09b3 ||
    code === 0x09b4 ||
    code === 0x09b5 ||
    code === 0x09ba ||
    code === 0x09bb ||
    code === 0x09c5 ||
    code === 0x09c6 ||
    code === 0x09c9 ||
    code === 0x09ca ||
    (code >= 0x09cf && code <= 0x09d6) ||
    (code >= 0x09d8 && code <= 0x09db) ||
    code === 0x09de ||
    code === 0x09e4 ||
    code === 0x09e5
  ) {
    return false;
  }
  return true;
}

/**
 * Identifies the Unicode script of a single character.
 * Note: Danda (। U+0964) and Double Danda (॥ U+0965) are shared Indic punctuation
 * used standardly in Bengali and are classified as 'Common'.
 */
export function getCharUnicodeScript(ch: string): UnicodeScriptName {
  if (!ch) return 'Common';
  const code = ch.codePointAt(0);
  if (code === undefined) return 'Common';

  // Danda & Double Danda are standard Bengali/Indic sentence punctuation
  if (code === 0x0964 || code === 0x0965) return 'Common';
  // Zero-width joiners used in Bengali conjuncts (র‍্য, খণ্ড-ত, etc.)
  if (code === 0x200c || code === 0x200d) return 'Common';

  if (code >= 0x0980 && code <= 0x09ff) return 'Bengali';
  if (code >= 0x0900 && code <= 0x097f) return 'Devanagari';
  if (code >= 0x0a00 && code <= 0x0a7f) return 'Gurmukhi';
  if (code >= 0x0a80 && code <= 0x0aff) return 'Gujarati';
  if (code >= 0x0b00 && code <= 0x0b7f) return 'Odia';
  if (code >= 0x0b80 && code <= 0x0bff) return 'Tamil';
  if (code >= 0x0c00 && code <= 0x0c7f) return 'Telugu';
  if (code >= 0x0c80 && code <= 0x0cff) return 'Kannada';
  if (code >= 0x0d00 && code <= 0x0d7f) return 'Malayalam';

  if (
    (code >= 0x0041 && code <= 0x005a) ||
    (code >= 0x0061 && code <= 0x007a) ||
    (code >= 0x00c0 && code <= 0x00d6) ||
    (code >= 0x00d8 && code <= 0x00f6) ||
    (code >= 0x00f8 && code <= 0x024f)
  ) {
    return 'Latin';
  }

  if (code >= 0x0400 && code <= 0x04ff) return 'Cyrillic';
  if (code >= 0x0370 && code <= 0x03ff) return 'Greek';
  if ((code >= 0x0600 && code <= 0x06ff) || (code >= 0x0750 && code <= 0x077f)) return 'Arabic';

  return 'Common';
}

/**
 * Returns true if the character is a Bengali dependent vowel sign (কার),
 * virama/hasanta (্), chandrabindu/anusvara/visarga (ঁ, ং, ঃ), or nukta (়).
 * These combining marks can ONLY legally attach to a Bengali base character.
 */
export function isBengaliDependentMark(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x0981 && code <= 0x0983) || // ঁ, ং, ঃ
    code === 0x09bc || // ় nukta
    (code >= 0x09be && code <= 0x09cc) || // া, ি, ী, ু, ূ, ৃ, ৄ, ে, ৈ, ো, ৌ
    code === 0x09cd || // ্ hasanta
    code === 0x09d7 || // ৗ au length mark
    code === 0x09e2 ||
    code === 0x09e3
  );
}

/**
 * Returns true if the character is a Bengali dependent vowel matra (কার: া..ৌ, ৗ)
 */
export function isBengaliVowelMatra(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 0x09be && code <= 0x09cc) || code === 0x09d7;
}

/**
 * Returns true if the character is a Bengali consonant or independent vowel
 */
export function isBengaliBaseLetter(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x0985 && code <= 0x09b9 && isAssignedBengaliCodepoint(code)) ||
    code === 0x09ce || // ৎ
    code === 0x09dc || // ড়
    code === 0x09dd || // ঢ়
    code === 0x09df || // য়
    code === 0x09f0 || // ৰ
    code === 0x09f1 // ৱ
  );
}

/**
 * Returns true if the character is a Bengali consonant (capable of taking a vowel matra or hasanta)
 */
export function isBengaliConsonant(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x0995 && code <= 0x09b9 && isAssignedBengaliCodepoint(code)) ||
    code === 0x09dc || // ড়
    code === 0x09dd || // ঢ়
    code === 0x09df || // য়
    code === 0x09f0 || // ৰ
    code === 0x09f1 // ৱ
  );
}

/**
 * Maps a character from any non-Bengali Indic Unicode block
 * (Devanagari, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam)
 * to its exact Bengali Unicode counterpart using ISCII-aligned block offsets
 * and phonetic equivalence rules.
 *
 * Example:
 * - Telugu 'క' (U+0C15, offset 0x15) -> Bengali 'ক' (U+0995, offset 0x15)
 * - Telugu 'ి' (U+0C3F, offset 0x3F) -> Bengali 'ি' (U+09BF, offset 0x3F)
 * - Together: 'కిংবা' -> 'কিংবা'
 */
export function mapIndicCharToBengali(ch: string): string | null {
  const script = getCharUnicodeScript(ch);
  if (!INDIC_SCRIPTS.has(script)) return null;

  const code = ch.charCodeAt(0);
  const base = code & ~0x7f;
  const offset = code - base;

  // Signs: Chandrabindu, Anusvara, Visarga
  if (offset === 0x00 || offset === 0x01) return '\u0981'; // ঁ
  if (offset === 0x02 || offset === 0x70) return '\u0982'; // ং (0x70 = Gurmukhi Tippi)
  if (offset === 0x03) return '\u0983'; // ঃ

  // Independent vowels
  if (offset >= 0x05 && offset <= 0x0c) {
    const target = 0x0980 + offset;
    return isAssignedBengaliCodepoint(target) ? String.fromCharCode(target) : null;
  }
  if (offset === 0x0d || offset === 0x0e || offset === 0x0f) return '\u098f'; // এ (short/candra/long E)
  if (offset === 0x10) return '\u0990'; // ঐ
  if (offset === 0x11 || offset === 0x12 || offset === 0x13) return '\u0993'; // ও (short/candra/long O)
  if (offset === 0x14) return '\u0994'; // ঔ

  // Consonants ক..ন
  if (offset >= 0x15 && offset <= 0x28) {
    return String.fromCharCode(0x0980 + offset);
  }
  if (offset === 0x29) return '\u09a8'; // ऩ / ன -> ন

  // Consonants প..র
  if (offset >= 0x2a && offset <= 0x30) {
    return String.fromCharCode(0x0980 + offset);
  }
  if (offset === 0x31) return '\u09b0'; // ऱ / ற / ఱ -> র
  if (offset === 0x32 || offset === 0x33 || offset === 0x34) return '\u09b2'; // ল / ळ / ऴ / ள / ழ / ళ -> ল
  if (offset === 0x35 || (script === 'Odia' && offset === 0x71)) return '\u09ac'; // व / వ / வ / ವ / വ / વ / ਵ / ଵ / ୱ -> ব
  if (offset >= 0x36 && offset <= 0x39) {
    return String.fromCharCode(0x0980 + offset); // শ, ষ, স, হ
  }

  // Nukta & Avagraha
  if (offset === 0x3c) return '\u09bc'; // ়
  if (offset === 0x3d) return '\u09bd'; // ঽ

  // Dependent vowel signs (Matras / কার)
  if (offset >= 0x3e && offset <= 0x44) {
    return String.fromCharCode(0x0980 + offset); // া, ি, ী, ু, ূ, ৃ, ৄ
  }
  if (offset === 0x45 || offset === 0x46 || offset === 0x47) return '\u09c7'; // ে (short/candra/long e matra)
  if (offset === 0x48) return '\u09c8'; // ৈ
  if (offset === 0x49 || offset === 0x4a || offset === 0x4b) return '\u09cb'; // ো (short/candra/long o matra)
  if (offset === 0x4c) return '\u09cc'; // ৌ

  // Virama / Hasanta & Khanda-Ta
  if (offset === 0x4d) return '\u09cd'; // ্
  if (offset === 0x4e) return '\u09ce'; // ৎ

  // Length marks
  if (offset === 0x55 || offset === 0x56 || offset === 0x57) return '\u09d7'; // ৗ

  // Additional precomposed nukta consonants
  if (offset === 0x5c) return '\u09dc'; // ড়
  if (offset === 0x5d) return '\u09dd'; // ঢ়
  if (offset === 0x5f) return '\u09df'; // য়

  // Vocalic R/L extensions
  if (offset >= 0x60 && offset <= 0x63) {
    return String.fromCharCode(0x0980 + offset);
  }

  // Digits (0x66..0x6F -> ০..৯)
  if (offset >= 0x66 && offset <= 0x6f) {
    return String.fromCharCode(0x0980 + offset);
  }

  return null;
}

/**
 * Validates whether a candidate string has well-formed Bengali Unicode orthography and phonotactics.
 * Rejects strings with:
 * - Any non-Bengali script letters
 * - Unassigned Bengali block codepoints
 * - Orphaned dependent vowel matras, hasanta, or anusvara/visarga at the start of the word
 * - Consecutive vowel matras without an intervening consonant/independent vowel
 * - Consecutive hasantas (্্)
 * - Hasanta (্) immediately following a vowel matra or anusvara/visarga
 */
export function isValidBengaliWord(word: string): boolean {
  if (!word || word.length === 0) return false;

  // Strip internal apostrophe/avirama if present
  const clean = word.replace(/[\u200c\u200d'’]/g, '');
  if (!clean) return false;

  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const ch = clean[i];

    // Allow Bengali digits alongside Bengali letters (e.g. ২৫শে, ১লা, ১৯৭১)
    if (code >= 0x09e6 && code <= 0x09ef) {
      continue;
    }

    if (!isAssignedBengaliCodepoint(code)) {
      return false;
    }

    // First character cannot be a dependent combining mark (matra, hasanta, anusvara, visarga, chandrabindu, nukta)
    if (i === 0 && isBengaliDependentMark(ch)) {
      return false;
    }

    if (i > 0) {
      const prev = clean[i - 1];
      const prevCode = prev.charCodeAt(0);

      // Two vowel matras in a row (except canonical decomposed ে + া or ে + ৗ before NFC)
      if (isBengaliVowelMatra(ch) && isBengaliVowelMatra(prev)) {
        const isDecomposedO = prevCode === 0x09c7 && (code === 0x09be || code === 0x09d7);
        if (!isDecomposedO) return false;
      }

      // Vowel matra cannot attach to an independent vowel (অ..ঔ) except অ + া -> আ in archaic/non-standard text, or এ + া
      if (isBengaliVowelMatra(ch) && prevCode >= 0x0985 && prevCode <= 0x0994) {
        return false;
      }

      // Two hasantas in a row (্্) is invalid
      if (code === 0x09cd && prevCode === 0x09cd) {
        return false;
      }

      // Hasanta (্) can only immediately follow a consonant (or nukta after consonant)
      if (code === 0x09cd && !isBengaliConsonant(prev) && prevCode !== 0x09bc) {
        return false;
      }

      // Vowel matra cannot immediately follow anusvara (ং) or visarga (ঃ) or chandrabindu (ঁ)
      if (isBengaliVowelMatra(ch) && prevCode >= 0x0981 && prevCode <= 0x0983) {
        return false;
      }
    }
  }

  // Last character cannot be a bare hasanta followed by nothing unless it is a valid halant word,
  // which is fine in Sanskritized Bengali (e.g. হঠাৎ, ভগবান্, সৎ), so trailing \u09CD is allowed after a consonant.
  return true;
}

/**
 * Curated high-frequency and literary Bengali vocabulary set for high-confidence
 * disambiguation of isolated tokens and single-character Latin homoglyph intrusions.
 */
const VERIFIED_BENGALI_LEXICON: ReadonlySet<string> = new Set([
  'কিংবা', 'কিম্বা', 'কিন্তু', 'কি', 'কী', 'কে', 'কাকে', 'কার', 'কাদের', 'কোন', 'কোনো', 'কোথায়', 'কোথায়', 'কখন', 'কেন', 'কেমন', 'কত',
  'বই', 'বইটি', 'বইটির', 'বইগুলো', 'বইখানি', 'অন্য', 'কিছু', 'কিছুই', 'অনেক', 'সব', 'সকল', 'সবাই', 'সমস্ত', 'প্রতিটি', 'প্রত্যেক',
  'এটি', 'এই', 'সেই', 'ওই', 'যে', 'সে', 'তা', 'তাই', 'তার', 'তাঁর', 'তাদের', 'তাঁদের', 'তাহার', 'তাহাদের', 'যাহা', 'তাহা',
  'আমি', 'আমরা', 'আমার', 'আমাদের', 'তুমি', 'তোমরা', 'তোমার', 'তোমাদের', 'আপনি', 'আপনারা', 'আপনার', 'আপনাদের',
  'এবং', 'ও', 'বা', 'অথবা', 'নতুবা', 'যদি', 'তবে', 'তাহলে', 'যেন', 'যখন', 'তখন', 'যেমন', 'তেমনি', 'কারণ', 'জন্য', 'জন্যে',
  'থেকে', 'হতে', 'হইতে', 'পর্যন্ত', 'সাথে', 'সঙ্গে', 'কাছে', 'মধ্যে', 'ভেতরে', 'ভিতরে', 'বাইরে', 'উপরে', 'ওপরে', 'নিচে', 'নীচে',
  'সামনে', 'পেছনে', 'পিছনে', 'পাশে', 'চারপাশে', 'দিকে', 'প্রতি', 'সম্পর্কে', 'বিষয়ে', 'বিষয়ে', 'দ্বারা', 'দিয়ে', 'দিয়ে',
  'হয়', 'হয়', 'হয়ে', 'হয়ে', 'হয়েছে', 'হয়েছে', 'হলো', 'হল', 'হবে', 'হতো', 'হত', 'হওয়া', 'হওয়া', 'হচ্ছে', 'হইতেছে',
  'করে', 'করেন', 'করেছে', 'করেছেন', 'করল', 'করলো', 'করবে', 'করবেন', 'করা', 'করার', 'করতে', 'করিতে', 'করিতেছিলেন',
  'বলে', 'বলেন', 'বলল', 'বললো', 'বলেছে', 'বলেছেন', 'বলা', 'বলার', 'বলতে', 'কথা', 'কাহিনী', 'গল্প', 'উপন্যাস', 'কবিতা', 'নাটক',
  'বাংলা', 'বাঙালি', 'বাঙ্গালী', 'ভাষা', 'সাহিত্য', 'সংস্কৃতি', 'ইতিহাস', 'বিজ্ঞান', 'দর্শন', 'সমাজ', 'দেশ', 'মানুষ', 'জনগণ',
  'জীবন', 'মৃত্যু', 'সময়', 'সময়', 'দিন', 'রাত', 'সকাল', 'বিকেল', 'সন্ধ্যা', 'বছর', 'মাস', 'সপ্তাহ', 'আজ', 'কাল', 'আগামীকাল', 'গতকাল',
  'এক', 'একটি', 'একটা', 'একজন', 'দুই', 'দুটি', 'তিন', 'তিনটি', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়', 'দশ', 'প্রথম', 'দ্বিতীয়', 'দ্বিতীয়', 'তৃতীয়', 'তৃতীয়',
  'ভালো', 'ভাল', 'মন্দ', 'খারাপ', 'সুন্দর', 'বড়', 'বড়', 'ছোট', 'নতুন', 'পুরাতন', 'পুরানো', 'সত্য', 'মিথ্যা', 'সহজ', 'কঠিন',
  'আছে', 'নেই', 'নাই', 'না', 'নয়', 'নয়', 'নি', 'যায়', 'যায়', 'গেল', 'গিয়ে', 'গিয়ে', 'আসে', 'এল', 'এলো', 'এসে', 'দেয়', 'দেয়', 'দিল', 'নিয়ে', 'নিয়ে',
  'মন', 'হৃদয়', 'হৃদয়', 'চোখ', 'মুখ', 'হাত', 'পা', 'মাথা', 'আকাশ', 'বাতাস', 'নদী', 'সাগর', 'পাহাড়', 'পাহাড়', 'বন', 'ফুল', 'ফল', 'পাখি',
  'রবীন্দ্রনাথ', 'ঠাকুর', 'নজরুল', 'ইসলাম', 'শরৎচন্দ্র', 'বঙ্কিমচন্দ্র', 'জীবনানন্দ', 'রক্তকরবী', 'সূচিপত্র', 'সূচীপত্র', 'অধ্যায়', 'অধ্যায়', 'পরিচ্ছেদ', 'ভূমিকা', 'উপসংহার',
  'অংশ', 'বংশ', 'সংবাদ', 'সংখ্যা', 'সংগীত', 'সঙ্গীত', 'সংস্করণ', 'সংগঠন', 'সংসার', 'সন্দেহ', 'সম্পর্ক', 'সম্পূর্ণ', 'সম্ভব', 'সমস্যা', 'সমাধান',
]);

/**
 * Valid Bengali inflectional suffixes that can legitimately attach directly to
 * English words or acronyms (e.g., VIPদের, SMSগুলো, TVতে, PDFটি).
 */
const LEGITIMATE_BENGALI_SUFFIXES_ON_LATIN = new Set([
  'দের', 'গুলো', 'গুলি', 'গুলোতে', 'গুলিকে', 'গুলোয়', 'গুলোয়',
  'টা', 'টি', 'টির', 'টার', 'টাকে', 'টিকে', 'খানা', 'খানি',
  'তে', 'কে', 'র', 'ের', 'এ', 'য়', 'য়', 'ভাবে', 'সহ', 'ভিত্তিক', 'মুক্ত', 'যুক্ত',
]);

/**
 * Checks if a mixed Latin+Bengali sub-token is a legitimate English word/acronym
 * with a standard Bengali suffix attached (e.g., VIPদের, SMSগুলো, PDFটি, TVতে).
 */
export function isLegitimateLatinWithBengaliSuffix(token: string): boolean {
  const match = token.match(/^([A-Za-z][A-Za-z0-9.]{1,15})([\u0980-\u09FF]+)$/);
  if (!match) return false;
  const [, , bengaliPart] = match;
  // A dependent vowel matra (like ি or া) cannot start a valid standalone suffix on a Latin stem
  if (isBengaliDependentMark(bengaliPart[0]) && bengaliPart[0] !== 'ে') {
    return false;
  }
  return LEGITIMATE_BENGALI_SUFFIXES_ON_LATIN.has(bengaliPart);
}

/**
 * Automatically detects the primary language and script profile of the document or page.
 */
export function detectPrimaryScriptAndLanguage(
  textSample: string,
  bookDetails?: BookDetails,
  configuredLanguage?: 'bn' | 'bn-en' | string
): {
  primaryLanguage: 'bn' | 'bn-en' | 'en' | 'hi' | 'ar';
  isBengaliDocument: boolean;
  isMixedBengaliEnglish: boolean;
} {
  const metaSample = `${bookDetails?.title || ''} ${bookDetails?.author || ''} ${bookDetails?.publisher || ''} ${bookDetails?.description || ''}`;
  const combined = `${metaSample}\n${textSample || ''}`;

  let bengaliCount = 0;
  let latinCount = 0;
  let devanagariCount = 0;
  let arabicCount = 0;

  for (const ch of combined) {
    const script = getCharUnicodeScript(ch);
    if (script === 'Bengali') bengaliCount++;
    else if (script === 'Latin') latinCount++;
    else if (script === 'Devanagari') devanagariCount++;
    else if (script === 'Arabic') arabicCount++;
  }

  if (configuredLanguage === 'bn-en') {
    return {
      primaryLanguage: 'bn-en',
      isBengaliDocument: true,
      isMixedBengaliEnglish: true,
    };
  }

  if (configuredLanguage === 'bn' || bengaliCount > 0) {
    const isMixed = latinCount > 15 && latinCount > bengaliCount * 0.1;
    if (bengaliCount === 0 && latinCount > 30 && configuredLanguage !== 'bn') {
      return {
        primaryLanguage: 'en',
        isBengaliDocument: false,
        isMixedBengaliEnglish: false,
      };
    }
    return {
      primaryLanguage: isMixed ? 'bn-en' : 'bn',
      isBengaliDocument: true,
      isMixedBengaliEnglish: isMixed,
    };
  }

  if (arabicCount > latinCount && arabicCount > 20) {
    return { primaryLanguage: 'ar', isBengaliDocument: false, isMixedBengaliEnglish: false };
  }
  if (devanagariCount > latinCount && devanagariCount > 20) {
    return { primaryLanguage: 'hi', isBengaliDocument: false, isMixedBengaliEnglish: false };
  }

  return {
    primaryLanguage: 'bn',
    isBengaliDocument: true,
    isMixedBengaliEnglish: false,
  };
}

/**
 * Normalizes malformed Bengali Unicode sequences within purely Bengali character runs:
 * 1. Canonicalizes decomposed two-part vowel signs:
 *    - \u09C7\u09BE (ে + া) -> \u09CB (ো)
 *    - \u09C7\u09D7 (ে + ৗ) -> \u09CC (ৌ)
 * 2. Strips invisible zero-width spaces (\u200B, \uFEFF, \u00AD) embedded inside Bengali words
 *    while preserving valid ZWNJ (\u200C) and ZWJ (\u200D).
 * 3. Repairs misordered vowel sign before hasanta+consonant in conjuncts:
 *    e.g., Consonant + Matra + Hasanta + Consonant -> Consonant + Hasanta + Consonant + Matra
 * 4. Deduplicates accidental consecutive identical vowel matras or hasantas:
 *    e.g., বাাংলা -> বাংলা, কিিংবা -> কিংবা, প্রথ্্ম -> প্রথম
 */
export function normalizeBengaliUnicodeSequences(text: string): {
  normalizedText: string;
  sequenceCorrections: Array<{ original: string; corrected: string; reason: 'malformed_vowel_sign' | 'broken_conjunct' }>;
} {
  if (!text) return { normalizedText: '', sequenceCorrections: [] };

  const sequenceCorrections: Array<{
    original: string;
    corrected: string;
    reason: 'malformed_vowel_sign' | 'broken_conjunct';
  }> = [];

  // 1. Strip zero-width space (\u200B), BOM (\uFEFF), soft hyphen (\u00AD) between Bengali characters
  let result = text.replace(/([\u0980-\u09FF])[\u200B\uFEFF\u00AD]+([\u0980-\u09FF])/g, '$1$2');

  // 2. Canonicalize split two-part vowel signs (ে + া -> ো, ে + ৗ -> ৌ)
  result = result
    .replace(/\u09C7\u09BE/g, '\u09CB')
    .replace(/\u09C7\u09D7/g, '\u09CC');

  // 3. Process Bengali word tokens for broken conjunct ordering and duplicate matras
  result = result.replace(/[\u0980-\u09FF\u200C\u200D]{2,}/g, (token) => {
    let fixed = token;
    let reason: 'malformed_vowel_sign' | 'broken_conjunct' = 'malformed_vowel_sign';

    // 3a. Misordered vowel matra before hasanta + consonant (e.g. ক + ি + ্ + ত -> ক + ্ + ত + ি)
    const reordered = fixed.replace(
      /([\u0995-\u09B9\u09DC-\u09DF])([\u09BE-\u09CC])(\u09CD[\u0995-\u09B9\u09DC-\u09DF])/g,
      '$1$3$2'
    );
    if (reordered !== fixed) {
      reason = 'broken_conjunct';
      fixed = reordered;
    }

    // 3b. Deduplicate consecutive identical dependent marks (e.g., াা -> া, িি -> ি, েে -> ে, ্্ -> ্, ংং -> ং)
    const deduped = fixed.replace(/([\u0981-\u0983\u09BC\u09BE-\u09CC\u09CD\u09D7])\1+/g, '$1');
    if (deduped !== fixed) {
      fixed = deduped;
    }

    if (fixed !== token && isValidBengaliWord(fixed)) {
      sequenceCorrections.push({
        original: token,
        corrected: fixed,
        reason,
      });
      return fixed;
    }

    return token;
  });

  return { normalizedText: result, sequenceCorrections };
}

/**
 * Estimates the approximate 2D bounding region of a token on the source PDF page
 * based on its line index, total lines on the page, and character offset in the line.
 */
export function estimateTokenPageRegion(
  lineIndex: number,
  totalLines: number,
  charIndexInLine: number,
  lineLength: number,
  tokenLength: number
): OcrTokenRegion {
  const safeTotalLines = Math.max(1, totalLines);
  const safeLineLen = Math.max(1, lineLength);

  // Typical book page has ~8% top/bottom margin and ~8% left/right margin
  const verticalSpan = 84;
  const lineHeightPct = Math.max(3, verticalSpan / safeTotalLines);
  const rawTop = 8 + (lineIndex / safeTotalLines) * verticalSpan;
  const topPercent = Math.max(0, Math.min(95, Math.round((rawTop - lineHeightPct * 0.4) * 10) / 10));
  const heightPercent = Math.max(4, Math.min(100 - topPercent, Math.round(lineHeightPct * 2.2 * 10) / 10));

  const horizontalSpan = 84;
  const rawLeft = 8 + (charIndexInLine / safeLineLen) * horizontalSpan;
  const rawWidth = Math.max(8, (tokenLength / safeLineLen) * horizontalSpan);
  const leftPercent = Math.max(0, Math.min(92, Math.round((rawLeft - 3) * 10) / 10));
  const widthPercent = Math.max(8, Math.min(100 - leftPercent, Math.round((rawWidth + 6) * 10) / 10));

  const ymin = Math.round(topPercent * 10);
  const xmin = Math.round(leftPercent * 10);
  const ymax = Math.min(1000, Math.round((topPercent + heightPercent) * 10));
  const xmax = Math.min(1000, Math.round((leftPercent + widthPercent) * 10));

  return {
    topPercent,
    leftPercent,
    widthPercent,
    heightPercent,
    box2d: [ymin, xmin, ymax, xmax],
  };
}

/**
 * Single-character Latin/homoglyph substitution candidates for Bengali words.
 * Used ONLY when a single Latin character is embedded inside a Bengali word AND
 * the resulting Bengali candidate is uniquely verified in VERIFIED_BENGALI_LEXICON.
 */
const LATIN_INTRUSION_CANDIDATES: Readonly<Record<string, string[]>> = {
  o: ['ং', 'ও', '০'],
  O: ['ং', 'ও', '০'],
  '0': ['০', 'ং'],
  b: ['ব', 'ভ'],
  B: ['ব', 'ভ'],
  k: ['ক', 'খ'],
  K: ['ক', 'খ'],
  m: ['ম'],
  M: ['ম'],
  n: ['ন', 'ণ'],
  N: ['ন', 'ণ'],
  l: ['ল', 'ি', 'ী'],
  L: ['ল'],
  i: ['ি', 'ই'],
  I: ['ী', 'ই'],
  r: ['র', 'ড়'],
  R: ['র'],
  s: ['স', 'শ', 'ষ'],
  S: ['স', 'শ', 'ষ'],
  p: ['প', 'ফ'],
  P: ['প', 'ফ'],
  t: ['ট', 'ত'],
  T: ['ট', 'ত'],
  d: ['ড', 'দ'],
  D: ['ড', 'দ'],
  g: ['গ', 'ঘ'],
  G: ['গ'],
  c: ['চ', 'ছ'],
  a: ['া', 'আ'],
  e: ['ে', 'এ'],
  u: ['ু', 'উ'],
};

/**
 * Analyzes a single core sub-token (stripped of outer punctuation and split on hyphens)
 * in its sentence context.
 */
function analyzeAndCorrectSubToken(
  subToken: string,
  hasBengaliInLine: boolean,
  nonBengaliIndicWordsInLine: number,
  isBengaliDoc: boolean
): {
  status: 'valid' | 'corrected' | 'flagged';
  correctedToken: string;
  scriptsDetected: UnicodeScriptName[];
  reason?: OcrCorrectionEntry['reason'] | OcrFlaggedToken['reason'];
  confidence?: 'high' | 'medium' | 'low';
  plausibleCandidates?: string[];
} {
  if (!subToken || subToken.length === 0) {
    return { status: 'valid', correctedToken: subToken, scriptsDetected: [] };
  }

  // Gather scripts present in this sub-token
  const scriptCounts = new Map<UnicodeScriptName, number>();
  for (const ch of subToken) {
    const s = getCharUnicodeScript(ch);
    if (s !== 'Common') {
      scriptCounts.set(s, (scriptCounts.get(s) || 0) + 1);
    }
  }

  const scriptsDetected = Array.from(scriptCounts.keys());

  // 1. If no letter scripts (only punctuation/numbers/symbols), it's valid
  if (scriptsDetected.length === 0) {
    return { status: 'valid', correctedToken: subToken, scriptsDetected: [] };
  }

  // 2. Pure Bengali token
  if (scriptsDetected.length === 1 && scriptsDetected[0] === 'Bengali') {
    if (isValidBengaliWord(subToken)) {
      return { status: 'valid', correctedToken: subToken, scriptsDetected };
    }
    // Malformed Bengali token (e.g., starts with an orphaned matra like 'িংবা' or 'াংবা')
    const candidates: string[] = [];
    if (isBengaliDependentMark(subToken[0])) {
      // Check if prepending common consonants forms a known Bengali word in lexicon for suggestions
      for (const cons of ['ক', 'ব', 'ম', 'ন', 'স', 'ত', 'প', 'য', 'র', 'ল', 'হ', 'দ', 'গ', 'চ', 'জ']) {
        const cand = cons + subToken;
        if (VERIFIED_BENGALI_LEXICON.has(cand)) {
          candidates.push(cand);
        }
      }
    }
    return {
      status: 'flagged',
      correctedToken: subToken,
      scriptsDetected,
      reason: 'malformed_vowel_sign',
      confidence: 'low',
      plausibleCandidates: candidates,
    };
  }

  // 3. Pure Non-Bengali token (e.g. pure Latin, pure Arabic, pure Devanagari, pure Telugu, etc.)
  if (scriptsDetected.length === 1 && scriptsDetected[0] !== 'Bengali') {
    const onlyScript = scriptsDetected[0];

    // Pure Latin, Arabic, Cyrillic, Greek words are legitimate foreign words/names/terms
    if (!INDIC_SCRIPTS.has(onlyScript)) {
      return { status: 'valid', correctedToken: subToken, scriptsDetected };
    }

    // What if it's a pure Indic token (e.g., Telugu 'కింబా' or Devanagari) inside a Bengali sentence?
    // Check if the line is a legitimate Sanskrit/Hindi/multi-word Indic passage (2+ non-Bengali Indic words on the line, or 'ॐ')
    if (onlyScript === 'Devanagari' && (nonBengaliIndicWordsInLine >= 2 || subToken.includes('ॐ'))) {
      return { status: 'valid', correctedToken: subToken, scriptsDetected };
    }

    // If this single Indic token appears inside a Bengali sentence (where the line has Bengali words):
    if (hasBengaliInLine && isBengaliDoc) {
      let mapped = '';
      let allMapped = true;
      for (const ch of subToken) {
        const s = getCharUnicodeScript(ch);
        if (INDIC_SCRIPTS.has(s)) {
          const m = mapIndicCharToBengali(ch);
          if (m) mapped += m;
          else {
            allMapped = false;
            break;
          }
        } else {
          mapped += ch;
        }
      }

      if (allMapped && isValidBengaliWord(mapped)) {
        // For an entirely non-Bengali token, auto-correct only if it matches a known Bengali word
        // (or is a Dravidian/Odia/Gujarati/Gurmukhi script that never occurs as a standalone quote in Bengali)
        const isDravidianOrRegional = onlyScript !== 'Devanagari';
        if (VERIFIED_BENGALI_LEXICON.has(mapped) || isDravidianOrRegional) {
          return {
            status: 'corrected',
            correctedToken: mapped,
            scriptsDetected,
            reason: 'isolated_indic_script_in_bengali_sentence',
            confidence: 'high',
          };
        }
        // Single isolated Devanagari word not in lexicon -> flag as low-confidence rather than guessing
        return {
          status: 'flagged',
          correctedToken: subToken,
          scriptsDetected,
          reason: 'isolated_indic_script_in_bengali_sentence',
          confidence: 'low',
          plausibleCandidates: [mapped],
        };
      }
    }

    return { status: 'valid', correctedToken: subToken, scriptsDetected };
  }

  // 4. MIXED-SCRIPT TOKEN (Contains Bengali + at least one other script inside the SAME sub-token!)
  const hasBengali = scriptCounts.has('Bengali');
  if (!hasBengali) {
    return { status: 'valid', correctedToken: subToken, scriptsDetected };
  }

  const hasOtherIndic = scriptsDetected.some((s) => INDIC_SCRIPTS.has(s));
  const hasLatin = scriptCounts.has('Latin');
  const hasCyrillicOrGreek = scriptCounts.has('Cyrillic') || scriptCounts.has('Greek');

  // Case 4A: Mixed Bengali + Other Indic Script (e.g., Telugu + Bengali 'కిংবা', Tamil + Bengali 'கிংবা', Devanagari + Bengali 'কिংবা', 'বাংলा', 'প্রথम')
  if (hasOtherIndic && !hasLatin && !hasCyrillicOrGreek) {
    let mapped = '';
    let allMapped = true;

    for (const ch of subToken) {
      const s = getCharUnicodeScript(ch);
      if (INDIC_SCRIPTS.has(s)) {
        const m = mapIndicCharToBengali(ch);
        if (m) {
          mapped += m;
        } else {
          allMapped = false;
          break;
        }
      } else {
        mapped += ch;
      }
    }

    if (allMapped) {
      const { normalizedText } = normalizeBengaliUnicodeSequences(mapped);
      if (isValidBengaliWord(normalizedText)) {
        return {
          status: 'corrected',
          correctedToken: normalizedText,
          scriptsDetected,
          reason: 'mixed_script_in_word',
          confidence: 'high',
        };
      }
    }

    return {
      status: 'flagged',
      correctedToken: subToken,
      scriptsDetected,
      reason: 'mixed_script_in_word',
      confidence: 'low',
      plausibleCandidates: allMapped ? [mapped] : [],
    };
  }

  // Case 4B: Mixed Bengali + Latin / Cyrillic / Greek
  // First check if it's a legitimate English word/acronym with a Bengali suffix (e.g., VIPদের, SMSগুলো, PDFটি, TVতে)
  if (hasLatin && !hasOtherIndic && !hasCyrillicOrGreek && isLegitimateLatinWithBengaliSuffix(subToken)) {
    return { status: 'valid', correctedToken: subToken, scriptsDetected };
  }

  // Check if it's a Bengali numeral token with Latin 'O'/'o' or Cyrillic 'О'/'о' mixed in (e.g., ১৯৭O -> ১৯৭০, ১o০ -> ১০০)
  if (/^[\u09E6-\u09EFoOОо0]+$/.test(subToken) && /[\u09E6-\u09EF]/.test(subToken)) {
    const fixedNum = subToken.replace(/[oOОо0]/g, '০');
    return {
      status: 'corrected',
      correctedToken: fixedNum,
      scriptsDetected,
      reason: 'latin_homoglyph_in_bengali',
      confidence: 'high',
    };
  }

  // Check if a single non-Bengali character (or Indic + Latin) is embedded inside a Bengali word
  const nonBengaliPositions: number[] = [];
  const chars = Array.from(subToken);
  for (let i = 0; i < chars.length; i++) {
    const s = getCharUnicodeScript(chars[i]);
    if (s !== 'Bengali' && s !== 'Common') {
      nonBengaliPositions.push(i);
    }
  }

  if (nonBengaliPositions.length === 1) {
    const pos = nonBengaliPositions[0];
    const intrudingChar = chars[pos];
    const replacements = LATIN_INTRUSION_CANDIDATES[intrudingChar] || [];
    const matchingLexiconWords: string[] = [];

    for (const rep of replacements) {
      const candidateChars = [...chars];
      candidateChars[pos] = rep;
      const candidate = candidateChars.join('');
      const { normalizedText } = normalizeBengaliUnicodeSequences(candidate);
      if (isValidBengaliWord(normalizedText) && VERIFIED_BENGALI_LEXICON.has(normalizedText)) {
        if (!matchingLexiconWords.includes(normalizedText)) {
          matchingLexiconWords.push(normalizedText);
        }
      }
    }

    // Correct ONLY when there is a single unambiguous verified Bengali lexicon match!
    if (matchingLexiconWords.length === 1) {
      return {
        status: 'corrected',
        correctedToken: matchingLexiconWords[0],
        scriptsDetected,
        reason: 'latin_homoglyph_in_bengali',
        confidence: 'high',
      };
    }

    return {
      status: 'flagged',
      correctedToken: subToken,
      scriptsDetected,
      reason: 'mixed_script_in_word',
      confidence: 'low',
      plausibleCandidates: matchingLexiconWords,
    };
  }

  // Multiple or unresolvable foreign characters mixed inside a Bengali token -> low confidence, flag for review!
  return {
    status: 'flagged',
    correctedToken: subToken,
    scriptsDetected,
    reason: 'mixed_script_in_word',
    confidence: 'low',
    plausibleCandidates: [],
  };
}

/**
 * Main synchronous Unicode Script Validation & Context-Aware Bengali Error Correction Pipeline.
 *
 * Preserves:
 * - Legitimate English words, numbers, math symbols, foreign names
 * - Multi-word Sanskrit/Devanagari shlokas & Arabic verses
 * - Historical/Sadhu-bhasha Bengali and uncommon vocabulary
 * - All HTML tags, Markdown syntax, URLs, and [IMAGE_FIGURE: ...] blocks
 * - Paragraph breaks, headings, lists, and punctuation
 *
 * Corrects (when high-confidence evidence exists):
 * - Mixed-script Indic characters embedded in Bengali words (e.g. 'కిংবা' -> 'কিংবা', 'বাংলा' -> 'বাংলা')
 * - Isolated Dravidian/Indic tokens in a Bengali sentence that map to valid Bengali words
 * - Unambiguous Latin homoglyphs in Bengali numbers/words (e.g. '১৯৭O' -> '১৯৭০', 'কিoবা' -> 'কিংবা')
 * - Malformed Bengali Unicode sequences (duplicate matras 'বাাংলা' -> 'বাংলা', misordered conjunct matras)
 *
 * Flags (without guessing) when confidence is low:
 * - Ambiguous character substitutions (e.g. 'কxবা', 'মনোxqযোগ')
 * - Orphaned dependent vowel signs with missing base consonants (e.g. 'িংবা')
 */
export function validateAndCorrectBengaliOcr(
  rawText: string,
  options?: {
    language?: 'bn' | 'bn-en' | string;
    bookDetails?: BookDetails;
  }
): {
  correctedText: string;
  rawText: string;
  validationReport: OcrValidationReport;
} {
  const langProfile = detectPrimaryScriptAndLanguage(
    rawText || '',
    options?.bookDetails,
    options?.language
  );

  if (!rawText) {
    return {
      correctedText: '',
      rawText: '',
      validationReport: {
        ...langProfile,
        correctionsApplied: [],
        flaggedTokens: [],
        hasSuspiciousTokens: false,
      },
    };
  }

  const correctionsApplied: OcrCorrectionEntry[] = [];
  const flaggedTokens: OcrFlaggedToken[] = [];

  // Step 1: Normalize malformed Bengali Unicode sequences (skipping [IMAGE_FIGURE: ...] and HTML tags)
  const lines = rawText.split('\n');
  const totalLines = lines.length;
  const processedLines: string[] = [];

  for (let lineIdx = 0; lineIdx < totalLines; lineIdx++) {
    const rawLine = lines[lineIdx];

    // Preserve [IMAGE_FIGURE: ...] lines untouched
    if (rawLine.trim().startsWith('[IMAGE_FIGURE:')) {
      processedLines.push(rawLine);
      continue;
    }

    // Apply intra-Bengali Unicode sequence normalization
    const { normalizedText: normLine, sequenceCorrections } = normalizeBengaliUnicodeSequences(rawLine);
    for (const seqCorr of sequenceCorrections) {
      correctionsApplied.push({
        originalToken: seqCorr.original,
        correctedToken: seqCorr.corrected,
        lineNumber: lineIdx + 1,
        contextSentence: rawLine.trim(),
        scriptsDetected: ['Bengali'],
        reason: seqCorr.reason,
        confidence: 'high',
        method: 'unicode_contextual',
      });
    }

    // Check line-level context: does this line contain Bengali words? How many pure Indic words?
    const hasBengaliInLine = /[\u0980-\u09FF]/.test(normLine);
    const nonBengaliIndicMatches = normLine.match(
      /(?<![\u0980-\u09FF])[\u0900-\u0963\u0966-\u097F\u0A00-\u0D7F]{2,}(?![\u0980-\u09FF])/g
    );
    const nonBengaliIndicWordsInLine = nonBengaliIndicMatches ? nonBengaliIndicMatches.length : 0;

    // Split line into segments preserving HTML tags, URLs, entities, and whitespace
    const protectedPattern =
      /(\[IMAGE_FIGURE:\s*\{[\s\S]*?\}\]|<[^>]+>|https?:\/\/[^\s<>)]+|&[a-zA-Z0-9#]+;|\s+)/g;
    const parts = normLine.split(protectedPattern);

    let charCursor = 0;
    const rebuiltParts: string[] = [];

    for (const part of parts) {
      if (!part) continue;

      // Skip protected HTML tags, URLs, entities, [IMAGE_FIGURE], or whitespace
      if (
        part.startsWith('<') ||
        part.startsWith('[IMAGE_FIGURE:') ||
        /^https?:\/\//.test(part) ||
        /^&[a-zA-Z0-9#]+;$/.test(part) ||
        /^\s+$/.test(part)
      ) {
        rebuiltParts.push(part);
        charCursor += part.length;
        continue;
      }

      // Extract leading and trailing punctuation around the word token
      const punctMatch = part.match(
        /^(['"“”‘’\(\[\{<«—–\-…*#_~]*)(.*?)(['"“”‘’\)\]\}>»—–\-,।॥.!?:;…*#_~]*)$/
      );
      if (!punctMatch || !punctMatch[2]) {
        rebuiltParts.push(part);
        charCursor += part.length;
        continue;
      }

      const [, leadingPunct, coreToken, trailingPunct] = punctMatch;
      const coreStartOffset = charCursor + leadingPunct.length;

      // Handle hyphenated / slash-separated compound tokens (e.g. AI-ভিত্তিক, নাটক-కిংবা-উপন্যাস)
      const subParts = coreToken.split(/([-–—/])/);
      let rebuiltCore = '';

      for (const sub of subParts) {
        if (sub === '-' || sub === '–' || sub === '—' || sub === '/') {
          rebuiltCore += sub;
          continue;
        }

        const analysis = analyzeAndCorrectSubToken(
          sub,
          hasBengaliInLine,
          nonBengaliIndicWordsInLine,
          langProfile.isBengaliDocument
        );

        const region = estimateTokenPageRegion(
          lineIdx,
          totalLines,
          coreStartOffset,
          normLine.length,
          coreToken.length
        );

        if (analysis.status === 'corrected') {
          rebuiltCore += analysis.correctedToken;
          correctionsApplied.push({
            originalToken: sub,
            correctedToken: analysis.correctedToken,
            lineNumber: lineIdx + 1,
            contextSentence: normLine.trim(),
            scriptsDetected: analysis.scriptsDetected,
            reason: (analysis.reason as OcrCorrectionEntry['reason']) || 'mixed_script_in_word',
            confidence: analysis.confidence || 'high',
            method: 'unicode_contextual',
            region,
          });
        } else if (analysis.status === 'flagged') {
          // Preserve original token when confidence is low and flag for review!
          rebuiltCore += sub;
          flaggedTokens.push({
            token: sub,
            lineNumber: lineIdx + 1,
            charIndexInLine: coreStartOffset,
            contextSentence: normLine.trim(),
            scriptsDetected: analysis.scriptsDetected,
            reason: (analysis.reason as OcrFlaggedToken['reason']) || 'mixed_script_in_word',
            confidence: (analysis.confidence === 'medium' ? 'medium' : 'low'),
            plausibleCandidates: analysis.plausibleCandidates || [],
            region,
          });
        } else {
          rebuiltCore += sub;
        }
      }

      rebuiltParts.push(`${leadingPunct}${rebuiltCore}${trailingPunct}`);
      charCursor += part.length;
    }

    processedLines.push(rebuiltParts.join(''));
  }

  const correctedText = processedLines.join('\n');

  return {
    correctedText,
    rawText,
    validationReport: {
      ...langProfile,
      correctionsApplied,
      flaggedTokens,
      hasSuspiciousTokens: flaggedTokens.length > 0,
    },
  };
}

/**
 * Convenience helper that returns the cleaned/corrected Bengali text directly.
 * Safe to call in headings, TOC extraction, XHTML conversion, and export pipelines.
 */
export function correctBengaliMixedScriptText(
  text: string,
  options?: {
    language?: 'bn' | 'bn-en' | string;
    bookDetails?: BookDetails;
  }
): string {
  if (!text) return '';
  return validateAndCorrectBengaliOcr(text, options).correctedText;
}

/**
 * Strict verification gate for Image-Based Multimodal Verification results.
 * Never treats a language model's prediction as definitive proof unless it passes:
 * 1. High visual confidence reported from inspecting the glyph region
 * 2. Valid Bengali Unicode orthography (isValidBengaliWord) with zero mixed scripts
 * 3. Single-word token constraint (no paraphrasing or sentence rewriting)
 * 4. Length consistency with the visible token on the page
 */
export function validateImageVerificationCandidate(
  flagged: OcrFlaggedToken,
  candidateWord: string,
  visualConfidence: 'high' | 'medium' | 'low',
  glyphEvidence?: string
): boolean {
  if (visualConfidence !== 'high') return false;
  if (!candidateWord || !candidateWord.trim()) return false;
  if (!glyphEvidence || glyphEvidence.trim().length < 2) return false;

  const trimmed = candidateWord.trim();
  // Must be a single word (no spaces)
  if (/\s/.test(trimmed)) return false;

  // Must be valid Bengali Unicode orthography with zero mixed scripts
  if (!isValidBengaliWord(trimmed)) return false;

  // Length must be consistent with the suspicious token (no hallucinated phrases)
  if (Math.abs(trimmed.length - flagged.token.length) > 3) return false;

  // If deterministic plausible candidates exist, verify structural compatibility
  if (flagged.plausibleCandidates.length > 0) {
    const sharesSkeleton = flagged.plausibleCandidates.some(
      (cand) => cand === trimmed || cand[0] === trimmed[0] || cand.slice(-1) === trimmed.slice(-1)
    );
    if (!sharesSkeleton) return false;
  }

  return true;
}

/**
 * Applies verified image-based corrections to the text and updates the validation report.
 */
export function applyImageVerifiedCorrections(
  currentText: string,
  currentReport: OcrValidationReport,
  verifiedItems: Array<{
    token: string;
    lineNumber: number;
    verifiedWord: string;
    visualConfidence: 'high' | 'medium' | 'low';
    glyphEvidence: string;
  }>
): {
  updatedText: string;
  updatedReport: OcrValidationReport;
} {
  if (!verifiedItems || verifiedItems.length === 0 || currentReport.flaggedTokens.length === 0) {
    return { updatedText: currentText, updatedReport: currentReport };
  }

  const lines = currentText.split('\n');
  const remainingFlags: OcrFlaggedToken[] = [];
  const newCorrections: OcrCorrectionEntry[] = [...currentReport.correctionsApplied];

  for (const flagged of currentReport.flaggedTokens) {
    const match = verifiedItems.find(
      (v) => v.token === flagged.token && v.lineNumber === flagged.lineNumber
    );

    if (
      match &&
      validateImageVerificationCandidate(
        flagged,
        match.verifiedWord,
        match.visualConfidence,
        match.glyphEvidence
      )
    ) {
      const lineIdx = flagged.lineNumber - 1;
      if (lineIdx >= 0 && lineIdx < lines.length) {
        const cleanVerified = match.verifiedWord.trim();
        lines[lineIdx] = lines[lineIdx].replace(flagged.token, cleanVerified);
        newCorrections.push({
          originalToken: flagged.token,
          correctedToken: cleanVerified,
          lineNumber: flagged.lineNumber,
          contextSentence: flagged.contextSentence,
          scriptsDetected: flagged.scriptsDetected,
          reason:
            flagged.reason === 'ambiguous_substitution'
              ? 'mixed_script_in_word'
              : flagged.reason,
          confidence: 'high',
          method: 'image_verified',
          region: flagged.region,
        });
        continue;
      }
    }

    // Keep in remainingFlags if not verified with high confidence
    remainingFlags.push(flagged);
  }

  return {
    updatedText: lines.join('\n'),
    updatedReport: {
      ...currentReport,
      correctionsApplied: newCorrections,
      flaggedTokens: remainingFlags,
      hasSuspiciousTokens: remainingFlags.length > 0,
      imageVerificationUsed: true,
    },
  };
}

/**
 * Sanitizes an array of PageItems for export/TOC processing while preserving originalOcr untouched.
 */
export function sanitizePagesForExport(
  pages: PageItem[],
  bookDetails?: BookDetails,
  language?: 'bn' | 'bn-en' | string
): PageItem[] {
  if (!pages || pages.length === 0) return [];
  return pages.map((p) => {
    if (!p || !p.markdown) return p;
    const { correctedText, validationReport } = validateAndCorrectBengaliOcr(p.markdown, {
      language,
      bookDetails,
    });
    return {
      ...p,
      markdown: correctedText,
      originalOcr: p.originalOcr || p.markdown,
      ocrValidation: p.ocrValidation || validationReport,
    };
  });
}
