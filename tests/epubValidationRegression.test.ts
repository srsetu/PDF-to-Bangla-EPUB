/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { PageItem, BookDetails, StructureConfig } from '../src/types';
import {
  generateEpubBlob,
  markdownToXhtml,
  formatInline,
  escapeXml,
  stripInvalidXmlChars,
  sanitizeXmlEntities,
  normalizeHtmlToXhtml,
  validateXmlString,
  validateEpubPackage,
} from '../src/utils/epubGenerator';

console.log('================================================================');
console.log('RUNNING EPUB VALIDATION & CROSSINK REGRESSION SUITE');
console.log('================================================================\n');

function createTestPage(pageNumber: number, markdown: string, isTocPage: boolean = false): PageItem {
  return {
    pageNumber,
    status: 'completed',
    thumbnailUrl: null,
    fullImageUrl: null,
    markdown,
    originalOcr: markdown,
    figures: [],
    isTocPage,
  };
}

// ---------------------------------------------------------------------
// TEST 1: CrossInk Root-Cause Regression: Malformed Markup in Gemini OCR
// ---------------------------------------------------------------------
{
  console.log('Test 1: CrossInk Root-Cause Regression (unclosed tags, bare <br>, &nbsp;, bare &)...');

  // This markdown represents typical raw OCR output that previously broke CrossInk:
  // - bare <br> tags (invalid XML)
  // - unclosed <b> and <i> tags
  // - bare ampersand: 'রবীন্দ্রনাথ & নজরুল'
  // - HTML entity: &nbsp; &mdash; &rdquo;
  // - multi-line alignment tag
  // - invalid XML control characters (form feed \x0C, null byte \x00)
  const problematicMarkdown = `
# প্রথম অধ্যায়: সূচনা\x0C\x00

<div class="text-center">
কবি রবীন্দ্রনাথ & নজরুল ইসলাম
</div>

এখানে একটি সাধারণ প্যারাগ্রাফ যাতে রয়েছে bare <br> লাইনব্রেক এবং &nbsp;&nbsp;স্পেস।
এছাড়াও রয়েছে <b>অর্ধেক বোল্ড টেক্সট যা বন্ধ করা হয়নি!
এবং <i>ইটালিক <b>ভুল নেস্টিং</i></b>।

সূত্রের উদাহরণ: a < b এবং c > d & e = f।
তিনি বললেন: "বাংলা বই পড়তে & লিখতে ভালোবাসি।"
`;

  const pages: PageItem[] = [
    createTestPage(1, '# বাংলা সাহিত্য\nগ্রন্থ পরিচিতি।'),
    createTestPage(2, problematicMarkdown),
  ];

  const bookDetails: BookDetails = {
    title: 'সাহিত্য & গবেষণা',
    author: 'গবেষক & প্রাবন্ধিক',
    publisher: 'বিশ্বভারতী & সংহিতা',
    genre: 'গবেষণা',
  };

  const { blob, filename, validationReport } = await generateEpubBlob(bookDetails, pages);

  assert.ok(blob, 'Blob must be generated');
  assert.ok(filename.endsWith('.epub'));
  assert.ok(validationReport, 'Validation report must be present');
  assert.equal(validationReport?.isValid, true, 'EPUB package must pass all validation gates');

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  // Check page_2.xhtml XML well-formedness
  const page2File = zip.file('OEBPS/page_2.xhtml');
  assert.ok(page2File, 'page_2.xhtml must exist in archive');
  const page2Content = await page2File.async('text');

  // Verify XML well-formedness using strict XML parser
  const xmlCheck = validateXmlString(page2Content);
  assert.equal(xmlCheck.isValid, true, `page_2.xhtml must be valid XML: ${xmlCheck.error}`);

  // Verify bare <br> was converted to self-closing <br />
  assert.ok(!page2Content.includes('<br>'), 'Bare <br> must not exist in XHTML');
  assert.ok(page2Content.includes('<br />') || page2Content.includes('<br/>'), 'Void <br /> must be valid XHTML');

  // Verify &nbsp; was converted to &#160;
  assert.ok(!page2Content.includes('&nbsp;'), '&nbsp; is forbidden in EPUB XHTML and must be converted');

  // Verify bare & was escaped to &amp;
  assert.ok(!page2Content.includes(' & '), 'Bare ampersand must be escaped');
  assert.ok(page2Content.includes('&amp;'), 'Escaped &amp; must be present');

  // Verify invalid XML characters (\x0C, \x00) were stripped
  assert.ok(!page2Content.includes('\x0C'), 'Form feed \\x0C must be stripped');
  assert.ok(!page2Content.includes('\x00'), 'Null byte \\x00 must be stripped');

  console.log('  ✓ Test 1 Passed: CrossInk malformed markup permanently prevented and healed.\n');
}

// ---------------------------------------------------------------------
// TEST 2: Special Characters, Mathematical Symbols, and Unicode Preserved
// ---------------------------------------------------------------------
{
  console.log('Test 2: Special Characters, Math Symbols, Unicode preserved without corruption...');

  const mathAndSpecial = `
# গাণিতিক ও ভাষাতাত্ত্বিক পাঠ

বাংলা যুক্তাক্ষর: ক্ষ, জ্ঞ, ষ্ণ, ণ্ড, হ্ণ, ব্র, ট্র, ঙ্ক, ঙ্গ, ঙ্ঘ।
দাঁড়ি ও বিরামচিহ্ন: একদা এক বাঘ ছিল। সে বনে বাস করত! তুমি কি যাবে?
শ্লোক (সংস্কৃত): ॐ असतो मा सद्गमय। तमसो मा ज्योतिर्गमय।
আরবি বর্ণমালা: بسم الله الرحمن الرحيم
গাণিতিক সূত্র: x ≤ y, a ≥ b, p ≠ q, ± 5, 2 × 3 = 6, 10 ÷ 2 = 5, ∞ (অসীম), 37° সেলসিয়াস।
উদ্ধৃতি: "তিনি বললেন, 'জ্ঞানই শক্তি'।"
`;

  const pages: PageItem[] = [
    createTestPage(1, mathAndSpecial),
  ];

  const bookDetails: BookDetails = {
    title: 'গণিত ও ব্যাকরণ (Math & Grammar)',
    author: 'অধ্যাপক ড. রহমান',
    publisher: 'শিক্ষা প্রকাশনী',
    genre: 'শিক্ষা',
  };

  const { blob } = await generateEpubBlob(bookDetails, pages);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const page1Content = await zip.file('OEBPS/page_1.xhtml')!.async('text');

  const check = validateXmlString(page1Content);
  assert.equal(check.isValid, true, `page_1.xhtml must be valid XML: ${check.error}`);

  // Verify Unicode preservation
  assert.ok(page1Content.includes('ক্ষ, জ্ঞ, ষ্ণ, ণ্ড'), 'Bengali conjuncts preserved');
  assert.ok(page1Content.includes('तमसो मा ज्योतिर्गमय'), 'Devanagari text preserved');
  assert.ok(page1Content.includes('بسم الله الرحمن الرحيم'), 'Arabic text preserved');
  assert.ok(page1Content.includes('≤') || page1Content.includes('&#8804;'), 'Less-than-equal preserved');
  assert.ok(page1Content.includes('≠') || page1Content.includes('&#8800;'), 'Not-equal preserved');
  assert.ok(page1Content.includes('°') || page1Content.includes('&#176;'), 'Degree symbol preserved');

  console.log('  ✓ Test 2 Passed: All complex Unicode and mathematical symbols intact.\n');
}

// ---------------------------------------------------------------------
// TEST 3: Multi-Line Alignment Blocks, Markdown Tables, and Lists
// ---------------------------------------------------------------------
{
  console.log('Test 3: Multi-Line Alignment Blocks, Markdown Tables, Ordered & Bulleted Lists...');

  const structuredMarkdown = `
# দ্বিতীয় খণ্ড

<div class="text-center">
উৎসর্গ
স্নেহের বরুণ ও কল্যাণীয়া অপুর উদ্দেশ্যে
</div>

<div class="text-right">
কলিকাতা, ২৫শে বৈশাখ, ১৩৪৫
</div>

| বিষয় | পৃষ্ঠা | মন্তব্য |
|---|---|---|
| ভূমিকা | ৫ | সংক্ষিপ্ত |
| মূল পাঠ্য | ১০ | বিস্তারিত |
| পরিশিষ্ট | ১০০ | তথ্যমূলক |

তালিকা ১ (বুলেট):
- প্রথম দফা
- দ্বিতীয় দফা
- তৃতীয় দফা

তালিকা ২ (নম্বরযুক্ত):
১. প্রারম্ভ
২. মধ্যভাগ
৩. সমাপ্তি
`;

  const pages: PageItem[] = [createTestPage(1, structuredMarkdown)];
  const { blob } = await generateEpubBlob(
    { title: 'কাঠামো পরীক্ষা', author: 'লেখক', publisher: 'প্রেস', genre: 'নাটক' },
    pages
  );

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const page1Content = await zip.file('OEBPS/page_1.xhtml')!.async('text');

  const check = validateXmlString(page1Content);
  assert.equal(check.isValid, true, `page_1.xhtml must be valid XML: ${check.error}`);

  assert.ok(page1Content.includes('class="text-center"'), 'Center alignment preserved');
  assert.ok(page1Content.includes('class="text-right"'), 'Right alignment preserved');
  assert.ok(page1Content.includes('<ul') && page1Content.includes('</ul>'), 'Unordered list created');
  assert.ok(page1Content.includes('<ol') && page1Content.includes('</ol>'), 'Ordered list created');
  assert.ok(page1Content.includes('<tr') && page1Content.includes('</td>'), 'Table rows created');

  console.log('  ✓ Test 3 Passed: Tables, lists, and multi-line alignment blocks well-formed.\n');
}

// ---------------------------------------------------------------------
// TEST 4: Fault Tolerance: Corrupted Chapter Healed Without Breaking Other Chapters
// ---------------------------------------------------------------------
{
  console.log('Test 4: Fault Tolerance: Corrupted chapter auto-repaired, other chapters intact...');

  const chapter1 = `# অধ্যায় ১\nসবকিছু একদম নিখুঁত লেখা এখানে।`;
  // Extremely corrupted chapter with random broken brackets, unclosed tags, and raw characters
  const chapter2Corrupted = `
# অধ্যায় ২: সংকট
<p class="text-center">
<center><<bad-tag attr=unquoted
লাইন ১ <br>
<b line 2 without close
&amp; & < > <<>>
<invalid-element>ভেতরের কথা</invalid-element>
`;
  const chapter3 = `# অধ্যায় ৩\nকাহিনী সুন্দরভাবে সমাপ্ত হলো।`;

  const pages: PageItem[] = [
    createTestPage(1, chapter1),
    createTestPage(2, chapter2Corrupted),
    createTestPage(3, chapter3),
  ];

  const { blob } = await generateEpubBlob(
    { title: 'সহনশীলতা টেস্ট', author: 'পরীক্ষক', publisher: 'ল্যাব', genre: 'বিজ্ঞান' },
    pages
  );

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  // Verify all 3 chapters exist and ARE ALL VALID XML!
  const ch1 = await zip.file('OEBPS/page_1.xhtml')!.async('text');
  const ch2 = await zip.file('OEBPS/page_2.xhtml')!.async('text');
  const ch3 = await zip.file('OEBPS/page_3.xhtml')!.async('text');

  assert.equal(validateXmlString(ch1).isValid, true, 'Chapter 1 must be valid XML');
  assert.equal(validateXmlString(ch2).isValid, true, 'Chapter 2 must be auto-repaired to valid XML');
  assert.equal(validateXmlString(ch3).isValid, true, 'Chapter 3 must be valid XML');

  // Verify content was not discarded in Chapter 2
  assert.ok(ch2.includes('সংকট'), 'Chapter title preserved');
  assert.ok(ch2.includes('লাইন ১'), 'Body text preserved');
  assert.ok(ch2.includes('ভেতরের কথা'), 'Unwrapped text preserved');

  console.log('  ✓ Test 4 Passed: Corrupted chapter healed without content loss or cross-chapter corruption.\n');
}

// ---------------------------------------------------------------------
// TEST 5: Complete EPUB Package Validation Gate
// ---------------------------------------------------------------------
{
  console.log('Test 5: Full EPUB Package Validation Gate (mimetype, container, opf, spine, nav)...');

  const pages: PageItem[] = [
    createTestPage(1, '# সোনার তরী\nরবীন্দ্রনাথ ঠাকুর'),
    createTestPage(2, '# ভূমিকা\nবইয়ের প্রেক্ষাপট।'),
    createTestPage(3, '# প্রথম অধ্যায়\nকাহিনী শুরু।'),
  ];

  const bookDetails: BookDetails = {
    title: 'প্যাকেজ ভ্যালিডেশন বই',
    author: 'লেখক নাম',
    publisher: 'বাংলা একাডেমি',
    genre: 'প্রবন্ধ',
    isbn: '978-984-00-1234-5',
    description: 'একটি পরীক্ষামূলক বই',
  };

  const { blob, validationReport } = await generateEpubBlob(bookDetails, pages);

  assert.ok(validationReport, 'Validation report returned');
  assert.equal(validationReport?.isValid, true, 'EPUB package must be valid');
  assert.equal(validationReport?.errors.length, 0, 'Must have zero package validation errors');
  assert.ok(validationReport!.totalXhtmlFilesValidated >= 4, 'Must validate cover/toc/nav and content pages');

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  // Direct test of validateEpubPackage on the generated zip
  const directCheck = await validateEpubPackage(zip);
  assert.equal(directCheck.isValid, true, `Direct package validation must pass: ${directCheck.errors.join(', ')}`);

  console.log('  ✓ Test 5 Passed: All 7 EPUB package components passed strict validation.\n');
}

// ---------------------------------------------------------------------
// TEST 6: Zero Silent Content Truncation on Long Chapters
// ---------------------------------------------------------------------
{
  console.log('Test 6: Zero Silent Content Truncation on Long Chapters...');

  const longParagraphs: string[] = ['# দীর্ঘ অধ্যায়\n'];
  for (let i = 1; i <= 50; i++) {
    longParagraphs.push(
      `অনুচ্ছেদ ${i}: এটি একটি দীর্ঘ অনুচ্ছেদ যাতে অনেক বাংলা শব্দ ও বাক্য অন্তর্ভুক্ত রয়েছে। বইয়ের প্রতিটি বাক্য নির্ভুলভাবে সংরক্ষিত হওয়া প্রয়োজন এবং কোনো অংশ কেটে বাদ দেওয়া চলবে না।`
    );
  }
  const longMarkdown = longParagraphs.join('\n\n');

  const pages: PageItem[] = [createTestPage(1, longMarkdown)];
  const { blob } = await generateEpubBlob(
    { title: 'দীর্ঘ বই', author: 'লেখক', publisher: 'প্রেস', genre: 'উপন্যাস' },
    pages
  );

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const content = await zip.file('OEBPS/page_1.xhtml')!.async('text');

  assert.equal(validateXmlString(content).isValid, true, 'Long chapter must be valid XML');
  assert.ok(content.includes('অনুচ্ছেদ 1:'), 'First paragraph must be present');
  assert.ok(content.includes('অনুচ্ছেদ 25:'), 'Middle paragraph must be present');
  assert.ok(content.includes('অনুচ্ছেদ 50:'), 'Last paragraph must be present');

  console.log('  ✓ Test 6 Passed: Long chapter completely preserved without truncation.\n');
}

console.log('================================================================');
console.log('ALL EPUB VALIDATION & REGRESSION TESTS COMPLETED SUCCESSFULLY!');
console.log('================================================================\n');
