import {
  getCharUnicodeScript,
  isValidBengaliWord,
  normalizeBengaliUnicodeSequences,
  detectPrimaryScriptAndLanguage,
  validateAndCorrectBengaliOcr,
  correctBengaliMixedScriptText,
  validateImageVerificationCandidate,
  applyImageVerifiedCorrections,
  sanitizePagesForExport
} from '../src/utils/bengaliOcrPipeline.js';
import { cleanHeadingText, markdownToXhtml, generateEpubBlob } from '../src/utils/epubGenerator.js';
import { extractAuthoritativeTocTree } from '../src/utils/tocExtractor.js';
import { PageItem } from '../src/types/index.js';
import JSZip from 'jszip';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=== Running Bengali OCR Accuracy & Mixed-Script Validation Tests ===\n');

  // ---------------------------------------------------------------------------
  // 1. Mandatory Regression Test: বইটি కిংবা অন্য কিছু। -> বইটি কিংবা অন্য কিছু।
  // ---------------------------------------------------------------------------
  console.log('Test 1: Mandatory Regression Test (Telugu mixed into Bengali word)...');
  {
    const rawInput = 'বইটি కిংবা অন্য কিছু।';
    const expectedOutput = 'বইটি কিংবা অন্য কিছু।';

    const result = validateAndCorrectBengaliOcr(rawInput);
    assertEqual(result.correctedText, expectedOutput, 'Should recover কিংবা from కిংবা');
    assertEqual(result.rawText, rawInput, 'Should preserve rawText untouched');
    assertEqual(result.validationReport.correctionsApplied.length, 1, 'Should record 1 mixed-script error fixed');
    assertEqual(result.validationReport.flaggedTokens.length, 0, 'High-confidence recovery should leave 0 unresolved flagged tokens');
    assertEqual(result.validationReport.correctionsApplied[0]?.originalToken, 'కిংবা', 'Original token in correction log should be కిংবা');
    assertEqual(result.validationReport.correctionsApplied[0]?.correctedToken, 'কিংবা', 'Corrected token in correction log should be কিংবা');
    assertEqual(result.validationReport.correctionsApplied[0]?.confidence, 'high', 'Correction confidence should be high');

    // Also test prompt context example
    const sentence2 = 'এটি একটি বই కిংবা অন্য কিছু।';
    assertEqual(
      correctBengaliMixedScriptText(sentence2),
      'এটি একটি বই কিংবা অন্য কিছু।',
      'Should recover কিংবা in full sentence context'
    );
  }
  console.log('  ✓ Passed\n');

  // ---------------------------------------------------------------------------
  // 2. Unicode Script Detection & Cross-Indic Mixed-Script Recovery
  // ---------------------------------------------------------------------------
  console.log('Test 2: Cross-Indic & Latin Homoglyph Mixed-Script Recovery...');
  {
    // Verify Unicode script classification
    assertEqual(getCharUnicodeScript('ক'), 'Bengali', 'ক should be Bengali');
    assertEqual(getCharUnicodeScript('క'), 'Telugu', 'క should be Telugu');
    assertEqual(getCharUnicodeScript('ि'), 'Devanagari', 'ि should be Devanagari');
    assertEqual(getCharUnicodeScript('।'), 'Common', 'Danda (।) should be classified as Common');
    assertEqual(getCharUnicodeScript('॥'), 'Common', 'Double Danda (॥) should be classified as Common');

    // Various accidental cross-script injections inside Bengali words
    const mixedSamples: Array<[string, string]> = [
      ['বইটি కిংবা অন্য কিছু।', 'বইটি কিংবা অন্য কিছু।'], // Telugu ക + ి
      ['বইটি கிংবা অন্য কিছু।', 'বইটি কিংবা অন্য কিছু।'], // Tamil க + ி
      ['বইটি কिংবা অন্য কিছু।', 'বইটি কিংবা অন্য কিছু।'], // Devanagari ि inside Bengali
      ['আমার সোনার বাংলा আমি তোমায় ভালোবাসি।', 'আমার সোনার বাংলা আমি তোমায় ভালোবাসি।'], // Devanagari ा
      ['প্রথम অধ্যায়: রবীন্দ্রনাথের সাহিत্য', 'প্রথম অধ্যায়: রবীন্দ্রনাথের সাহিত্য'], // Devanagari म and त
      ['সর্বदা সত্য কথা বলবে।', 'সর্বদা সত্য কথা বলবে।'], // Devanagari द
      ['বইটি কিoবা অন্য কিছু।', 'বইটি কিংবা অন্য কিছু।'], // Latin o for अनुस्वार ং
      ['১৯৭O সালের মুক্তিযুদ্ধ।', '১৯৭০ সালের মুক্তিযুদ্ধ।'] // Latin O in Bengali numerals
    ];

    for (const [input, expected] of mixedSamples) {
      const actual = correctBengaliMixedScriptText(input);
      assertEqual(actual, expected, `Failed cross-script recovery for: ${input}`);
    }
  }
  console.log('  ✓ Passed\n');

  // ---------------------------------------------------------------------------
  // 3. Bengali Words with Vowel Signs (কার), Conjuncts (যুক্তাক্ষর), and Diacritics
  // ---------------------------------------------------------------------------
  console.log('Test 3: Bengali Conjuncts (যুক্তাক্ষর), Vowel Signs (কার), and Sequence Normalization...');
  {
    const complexBengali =
      'বিজ্ঞান, শিক্ষা, তীক্ষ্ণ মেধা, ব্রাহ্মণ, রাষ্ট্র, উজ্জ্বল, সান্ত্বনা, দ্বন্দ্ব, জলোচ্ছ্বাস ও সূক্ষ্ম বিশ্লেষণ। চাঁদের আলোয় দুঃখ-কষ্ট ভুলে যাওয়া।';
    const res = validateAndCorrectBengaliOcr(complexBengali);
    assertEqual(res.correctedText, complexBengali, 'Valid complex Bengali conjuncts must remain completely unchanged');
    assertEqual(res.validationReport.correctionsApplied.length, 0, 'No errors should be triggered on valid Bengali conjuncts');

    // Split two-part vowel sign normalization (ে + া -> ো, ে + ৗ -> ৌ)
    const splitVowelInput = 'ক\u09C7\u09BEথায় প\u09C7\u09D7ঁছেছ?';
    const { normalizedText: normalizedVowel } = normalizeBengaliUnicodeSequences(splitVowelInput);
    assertEqual(normalizedVowel, 'কোথায় পৌঁছেছ?', 'Split two-part matras should normalize to canonical composed matras');

    // Duplicate consecutive matras caused by OCR jitter (বাাংলা -> বাংলা)
    const { normalizedText: dupNormalized } = normalizeBengaliUnicodeSequences('বাাংলা সাহিত্যেের');
    assertEqual(dupNormalized, 'বাংলা সাহিত্যের', 'Duplicate consecutive identical vowel matras should be deduplicated');

    // Misordered matra-before-hasanta repair (ক + ি + ্ + ত -> ক + ্ + ত + ি)
    const misordered = 'শক\u09BF\u09CDত'; // শ + ক + ি + ্ + ত -> শক্তি
    const { normalizedText: fixedOrder } = normalizeBengaliUnicodeSequences(misordered);
    assertEqual(fixedOrder, 'শক্তি', 'Misordered matra before hasanta should be reordered after consonant cluster');
  }
  console.log('  ✓ Passed\n');

  // ---------------------------------------------------------------------------
  // 4. Mixed Bengali-English Documents, Numbers, & Bilingual Hyphenated/Inflected Forms
  // ---------------------------------------------------------------------------
  console.log('Test 4: Mixed Bengali-English, Numbers, Mathematical Symbols, & Bilingual Suffixes...');
  {
    const mixedBnEn =
      '২০২৫ সালে AI-ভিত্তিক Modern OCR Technology এবং Machine Learning এর মাধ্যমে PDFটি ও VIPদের 100% নির্ভুলভাবে (x + y = 42) রূপান্তর করা সম্ভব।';
    const res = validateAndCorrectBengaliOcr(mixedBnEn);
    assertEqual(res.correctedText, mixedBnEn, 'Legitimate English words, numbers, math symbols, and bilingual suffixes must be preserved');
    assertEqual(res.validationReport.flaggedTokens.length, 0, 'Valid bilingual tokens (PDFটি, VIPদের, AI-ভিত্তিক) must not be flagged');

    const profile = detectPrimaryScriptAndLanguage(mixedBnEn);
    assertTrue(profile.isBengaliDocument, 'isBengaliDocument should be true');
    assertEqual(profile.primaryLanguage, 'bn-en', 'Mixed Bengali-English text should detect as bn-en');
    assertTrue(profile.isMixedBengaliEnglish, 'isMixedBengaliEnglish should be true');
  }
  console.log('  ✓ Passed\n');

  // ---------------------------------------------------------------------------
  // 5. Legitimate Foreign Words, Names, Sanskrit Shlokas, & Arabic Verses
  // ---------------------------------------------------------------------------
  console.log('Test 5: Legitimate Foreign Names, Sanskrit Shlokas (Devanagari), & Arabic Verses...');
  {
    const multilingualPassage = [
      'উপন্যাসে William Shakespeare এবং Rabindranath Tagore-এর তুলনামূলক আলোচনা রয়েছে।',
      'সংস্কৃত শ্লোক: ॐ असतो मा सद्गमय। तमसो मा ज्योतिर्गमय।',
      'আরবি উদ্ধৃতি: بسم الله الرحمن الرحيم'
    ].join('\n\n');

    const res = validateAndCorrectBengaliOcr(multilingualPassage);
    assertEqual(
      res.correctedText,
      multilingualPassage,
      'Multi-word Sanskrit Devanagari shlokas, Arabic verses, and English names must be preserved verbatim'
    );
    assertEqual(res.validationReport.correctionsApplied.length, 0, 'Multi-word Devanagari shloka should not be converted to Bengali');
    assertEqual(res.validationReport.flaggedTokens.length, 0, 'Legitimate foreign passages should not be flagged');
  }
  console.log('  ✓ Passed\n');

  // ---------------------------------------------------------------------------
  // 6. Historical Bengali Texts (সাধু ভাষা), Authorial Spelling, & Punctuation
  // ---------------------------------------------------------------------------
  console.log('Test 6: Historical Bengali (সাধু ভাষা), Uncommon Vocabulary, & Punctuation Preservation...');
  {
    const historicalText =
      '“রবীন্দ্রনাথ ঠাকুর মহাশয় তৎকালে গীতাঞ্জলি রচনা করিতেছিলেন; তদুপরি কিম্বা সূচীপত্র ও নির্ঘণ্ট—সকলই অপরিবর্তিত রহিয়াছে।”\n\nদ্বিতীয় অনুচ্ছেদ: তাঁহাদের কথোপকথন চলিতে লাগিল।';
    const res = validateAndCorrectBengaliOcr(historicalText);
    assertEqual(
      res.correctedText,
      historicalText,
      'Historical Sadhu-bhasha spellings (করিতেছিলেন, কিম্বা, সূচীপত্র), quotes, and paragraph breaks must be preserved'
    );
    assertEqual(res.validationReport.correctionsApplied.length, 0, 'Zero false-positive corrections on historical Bengali');
  }
  console.log('  ✓ Passed\n');

  // ---------------------------------------------------------------------------
  // 7. Low-Confidence Ambiguous Cases & Selective Image Verification Gate
  // ---------------------------------------------------------------------------
  console.log('Test 7: Low-Confidence Preservation, Flagging, & Image Verification Gate...');
  {
    // A Latin 'x' inside a Bengali word has no deterministic homoglyph mapping
    const ambiguousInput = 'বইটি কxবা অন্য কিছু।';
    const res = validateAndCorrectBengaliOcr(ambiguousInput);

    assertEqual(
      res.correctedText,
      ambiguousInput,
      'Low-confidence mixed-script token (কxবা) must NOT be guessed without visual evidence'
    );
    assertEqual(res.validationReport.flaggedTokens.length, 1, 'Ambiguous token কxবা must be flagged for image verification / review');
    const flagged = res.validationReport.flaggedTokens[0];
    assertEqual(flagged.token, 'কxবা', 'Flagged token should be কxবা');
    assertEqual(flagged.confidence, 'low', 'Flagged token confidence should be low');
    assertTrue(flagged.region !== undefined, 'Flagged token must include estimated 2D page region');
    assertTrue(
      flagged.region!.topPercent >= 0 &&
        flagged.region!.topPercent <= 100 &&
        flagged.region!.leftPercent >= 0 &&
        flagged.region!.leftPercent <= 100,
      'Estimated page region coordinates must be normalized within [0, 100]'
    );

    // Test strict image verification gate (validateImageVerificationCandidate)
    assertTrue(
      validateImageVerificationCandidate(flagged, 'কিংবা', 'high', 'Confirmed ক + ি + ং + ব + া in source glyph crop'),
      'Image verification gate should accept valid Bengali word কিংবা with high visual confidence and glyph evidence'
    );
    assertTrue(
      !validateImageVerificationCandidate(flagged, 'কিংবা', 'low', 'Blurry glyph'),
      'Image verification gate must reject low visual confidence candidate'
    );
    assertTrue(
      !validateImageVerificationCandidate(flagged, 'కిংবা', 'high', 'Glyph check'),
      'Image verification gate must reject candidate containing non-Bengali script'
    );
    assertTrue(
      !validateImageVerificationCandidate(flagged, 'কিংবা বই', 'high', 'Glyph check'),
      'Image verification gate must reject multi-word phrase replacement for a single token'
    );

    // Test applying verified image correction
    const verifiedRes = applyImageVerifiedCorrections(res.correctedText, res.validationReport, [
      {
        token: 'কxবা',
        lineNumber: 1,
        verifiedWord: 'কিংবা',
        visualConfidence: 'high',
        glyphEvidence: 'Confirmed ক + ি + ং + ব + া in source glyph crop'
      }
    ]);
    assertEqual(
      verifiedRes.updatedText,
      'বইটি কিংবা অন্য কিছু।',
      'Applying image-verified candidate should resolve কxবা -> কিংবা'
    );
    assertEqual(verifiedRes.updatedReport.flaggedTokens.length, 0, 'Resolved token should be removed from flaggedTokens');
    assertTrue(Boolean(verifiedRes.updatedReport.imageVerificationUsed), 'imageVerificationUsed should be true');
  }
  console.log('  ✓ Passed\n');

  // ---------------------------------------------------------------------------
  // 8. End-to-End Integration Across Headings, TOC, and EPUB Export
  // ---------------------------------------------------------------------------
  console.log('Test 8: Shared Pipeline Integration (Headings, TOC, Page Export, & EPUB)...');
  {
    // Heading cleaner
    assertEqual(
      cleanHeadingText('প্রথম অধ্যায়: বইটি కిংবা অন্য কিছু'),
      'প্রথম অধ্যায়: বইটি কিংবা অন্য কিছু',
      'cleanHeadingText should fix mixed-script errors in headings'
    );

    // Markdown to XHTML body conversion
    const xhtmlBody = markdownToXhtml('এটি একটি বই కిংবা অন্য কিছু।');
    assertTrue(xhtmlBody.includes('এটি একটি বই কিংবা অন্য কিছু।'), 'markdownToXhtml should output corrected Bengali text');
    assertTrue(!xhtmlBody.includes('కిংবা'), 'markdownToXhtml must not contain Telugu characters');

    // Page sanitization & originalOcr preservation
    const samplePages: PageItem[] = [
      {
        pageNumber: 1,
        status: 'done',
        imageBlob: null,
        imageUrl: '',
        markdown: '# প্রথম অধ্যায়: বইটি కిংবা অন্য কিছু\n\nএটি একটি বই కిংবা অন্য কিছু।',
        originalOcr: '# প্রথম অধ্যায়: বইটি కిংবা অন্য কিছু\n\nএটি একটি বই కిংবা অন্য কিছু।',
        retryCount: 0,
        pageType: 'text',
        detectedChapters: ['প্রথম অধ্যায়: বইটি కిংবা অন্য কিছু']
      }
    ];

    const sanitizedPages = sanitizePagesForExport(samplePages);
    assertEqual(
      sanitizedPages[0].markdown,
      '# প্রথম অধ্যায়: বইটি কিংবা অন্য কিছু\n\nএটি একটি বই কিংবা অন্য কিছু।',
      'sanitizePagesForExport should sanitize page markdown'
    );
    assertEqual(
      sanitizedPages[0].originalOcr,
      '# প্রথম অধ্যায়: বইটি కిংবা অন্য কিছু\n\nএটি একটি বই కిংবা অন্য কিছু।',
      'sanitizePagesForExport must preserve originalOcr untouched'
    );

    // TOC extraction & EPUB generation
    const tocSummary = extractAuthoritativeTocTree(sanitizedPages);
    assertEqual(
      tocSummary.tree[0]?.title,
      'প্রথম অধ্যায়: বইটি কিংবা অন্য কিছু',
      'Extracted TOC entry title must have clean Bengali script'
    );

    const epubRes = await generateEpubBlob(
      {
        title: 'বইটি కిংবা অন্য কিছু',
        author: 'রবীন্দ্রনাथ ঠাকুর',
        publisher: 'বিশ্বভারতী',
        publishYear: '২০২৫',
        description: 'বইটি కిংবা অন্য কিছু',
        isbn: ''
      },
      samplePages
    );
    const zip = await JSZip.loadAsync(await epubRes.blob.arrayBuffer());
    const chapter1Xhtml = await zip.file('OEBPS/page_1.xhtml')?.async('string');
    const opfContent = await zip.file('OEBPS/content.opf')?.async('string');

    assertTrue(
      Boolean(
        chapter1Xhtml &&
          chapter1Xhtml.includes('প্রথম অধ্যায়: বইটি কিংবা অন্য কিছু') &&
          chapter1Xhtml.includes('এটি একটি বই কিংবা অন্য কিছু।')
      ),
      'EPUB chapter XHTML must contain corrected কিংবা in both heading and body'
    );
    assertTrue(Boolean(chapter1Xhtml && !chapter1Xhtml.includes('కిংবা')), 'EPUB chapter XHTML must not contain Telugu కిংবা');
    assertTrue(Boolean(opfContent && opfContent.includes('বইটি কিংবা অন্য কিছু')), 'EPUB OPF metadata title must be corrected');
    assertTrue(Boolean(opfContent && opfContent.includes('রবীন্দ্রনাথ ঠাকুর')), 'EPUB OPF metadata author must be corrected');
  }
  console.log('  ✓ Passed\n');

  console.log('🎉 ALL BENGALI OCR VALIDATION & MIXED-SCRIPT REGRESSION TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
