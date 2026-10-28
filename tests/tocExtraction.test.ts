/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { PageItem, BookDetails, StructureConfig, PdfOutlineItem } from '../src/types';
import {
  extractAuthoritativeTocTree,
  detectTocPages,
  parseTocLineCandidate,
  validateTocCandidate,
  buildFallbackNavigation,
  isTableOfContentsLabel,
  isDataValueOrUnitLine,
  isOrdinaryDataListPage,
  evaluateTocPageClassification,
} from '../src/utils/tocExtractor';
import {
  generateEpubBlob,
  isTableOfContentsText,
  isLikelyTocPage,
  markdownToXhtml,
} from '../src/utils/epubGenerator';
import JSZip from 'jszip';

console.log('====================================================');
console.log('RUNNING DEDICATED TOC EXTRACTION & EPUB TESTS (1-10)');
console.log('====================================================\n');

// Helper to create synthetic PageItem
function createPage(
  pageNumber: number,
  markdown: string,
  isTocPage: boolean = false
): PageItem {
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
// TEST CASE 1: Standard TOC (12 chapters)
// ---------------------------------------------------------------------
{
  console.log('Test Case 1: Standard TOC with 12 chapters...');

  const tocMarkdown = `
# সূচিপত্র

১. ভূমিকা ........................ ৫
২. প্রথম অধ্যায়: সূচনা .......... ১০
৩. দ্বিতীয় অধ্যায়: নদীর বাঁকে ..... ২৫
৪. তৃতীয় অধ্যায়: অচেনা অতিথি .... ৪২
৫. চতুর্থ অধ্যায়: অন্ধকার রাত ..... ৬০
৬. পঞ্চম অধ্যায়: আলোয় ফেরা ..... ৭৮
৭. ষষ্ঠ অধ্যায়: নতুন দিন ........ ৯৫
৮. সপ্তম অধ্যায়: পরীক্ষা ........ ১১২
৯. অষ্টম অধ্যায়: সংঘাত .......... ১৩০
১০. নবম অধ্যায়: বিজয় .......... ১৪৮
১১. দশম অধ্যায়: পুনর্মিলন ....... ১৬৫
১২. উপসংহার .................... ১৮০
`;

  const pages: PageItem[] = [
    createPage(1, '# বাংলা সাহিত্য\n\nউৎসর্গপত্র ও প্রকাশনা তথ্য।'),
    createPage(2, tocMarkdown, true),
    ...Array.from({ length: 12 }, (_, i) =>
      createPage(i + 3, `# অধ্যায় ${i + 1}\n\nএখানে বিস্তারিত মূল পাঠ্য।`)
    ),
  ];

  const result = extractAuthoritativeTocTree(pages);

  assert.equal(result.isFallback, false, 'Expected original TOC extraction, not fallback');
  assert.equal(result.tree.length, 12, 'Expected exactly 12 TOC entries');
  assert.equal(result.diagnostics.extractedEntriesCount, 12);
  assert.equal(result.diagnostics.validatedEntriesCount, 12);
  assert.equal(result.tree[0].title, '১. ভূমিকা');
  assert.equal(result.tree[11].title, '১২. উপসংহার');
  console.log('  ✓ Test Case 1 Passed: Exactly 12 verified entries extracted.\n');
}

// ---------------------------------------------------------------------
// TEST CASE 2: Long Book (20 chapters with dozens of body headings)
// ---------------------------------------------------------------------
{
  console.log('Test Case 2: Long Book (20 chapters, body headings must NOT be added)...');

  const tocLines: string[] = ['# বিষয়সূচি\n'];
  for (let i = 1; i <= 20; i++) {
    tocLines.push(`অধ্যায় ${i}: পরিচ্ছেদ নাম ............. ${i * 10}`);
  }

  const tocPage = createPage(2, tocLines.join('\n'), true);

  // Content pages filled with bold sentences, sub-headings, body quotes, dialogue
  const contentPages: PageItem[] = [];
  for (let i = 1; i <= 20; i++) {
    const pageNum = i + 2;
    const bodyWithHeadings = `
# অধ্যায় ${i}: পরিচ্ছেদ নাম

**একটি গুরুত্বপূর্ণ ভূমিকা বাক্য যা হেডিং নয়**

## অনাকাঙ্ক্ষিত বডি সাব-হেডিং ১
এখানে সাধারণ বর্ণনা চলছে।

### অনাকাঙ্ক্ষিত বডি সাব-হেডিং ২
আরও কিছু কথা।

**চরিত্রের নাম: রাহুল**
"আমি যাব না!"

<center>সেকশন বিভাজক টেক্সট</center>

## অন্য আরেকটি অনুচ্ছেদ শিরোনাম
বইয়ের শেষের কথা।
`;
    contentPages.push(createPage(pageNum, bodyWithHeadings));
  }

  const allPages = [createPage(1, '# প্রচ্ছদ ও নাম'), tocPage, ...contentPages];
  const result = extractAuthoritativeTocTree(allPages);

  assert.equal(result.isFallback, false);
  assert.equal(result.tree.length, 20, 'Expected exactly 20 chapter entries');

  // Verify that NONE of the body headings leaked into the TOC tree or children!
  function checkNoBodyHeadings(nodes: typeof result.tree) {
    for (const node of nodes) {
      assert.ok(
        !node.title.includes('অনাকাঙ্ক্ষিত বডি সাব-হেডিং'),
        `Forbidden body heading found in TOC: ${node.title}`
      );
      assert.ok(
        !node.title.includes('একটি গুরুত্বপূর্ণ ভূমিকা বাক্য'),
        `Forbidden bold body sentence found in TOC: ${node.title}`
      );
      if (node.children && node.children.length > 0) {
        checkNoBodyHeadings(node.children);
      }
    }
  }
  checkNoBodyHeadings(result.tree);

  console.log('  ✓ Test Case 2 Passed: 20 chapters preserved, ZERO body headings leaked.\n');
}

// ---------------------------------------------------------------------
// TEST CASE 3: Multi-Page TOC (Spans 3 consecutive pages)
// ---------------------------------------------------------------------
{
  console.log('Test Case 3: Multi-Page TOC (Spans 3 consecutive pages)...');

  const page2TOC = `
# সূচিপত্র

১. প্রথম অধ্যায় ............... ১০
২. দ্বিতীয় অধ্যায় ............. ২৫
৩. তৃতীয় অধ্যায় .............. ৪০
৪. চতুর্থ অধ্যায় .............. ৫৫
৫. পঞ্চম অধ্যায় ............... ৭০
`;

  const page3TOC = `
সূচিপত্র (চলমান)

৬. ষষ্ঠ অধ্যায় ................ ৮৫
৭. সপ্তম অধ্যায় .............. ১০০
৮. অষ্টম অধ্যায় .............. ১১৫
৯. নবম অধ্যায় ................ ১৩০
১০. দশম অধ্যায় ............... ১৪৫
`;

  const page4TOC = `
সূচিপত্র (শেষ অংশ)

১১. একাদশ অধ্যায় ............. ১৬০
১২. দ্বাদশ অধ্যায় ............. ১৭৫
১৩. ত্রয়োদশ অধ্যায় ........... ১৯০
১৪. চতুর্দশ অধ্যায় ........... ২০৫
১৫. সমাপ্তি .................. ২২০
`;

  const page5Body = `
# প্রথম অধ্যায়

এখানে উপন্যাসের মূল কাহিনী শুরু হলো।
`;

  const pages: PageItem[] = [
    createPage(1, '# বইয়ের নাম\nবিশ্বসাহিত্য কেন্দ্র'),
    createPage(2, page2TOC),
    createPage(3, page3TOC),
    createPage(4, page4TOC),
    createPage(5, page5Body),
  ];

  const detected = detectTocPages(pages);
  assert.deepEqual(detected, [2, 3, 4], 'Pages 2, 3, 4 must all be detected as TOC pages');

  const result = extractAuthoritativeTocTree(pages);
  assert.equal(result.isFallback, false);
  assert.equal(result.tree.length, 15, 'All 15 entries across the 3 pages must be extracted');
  assert.equal(result.tree[0].title, '১. প্রথম অধ্যায়');
  assert.equal(result.tree[5].title, '৬. ষষ্ঠ অধ্যায়');
  assert.equal(result.tree[14].title, '১৫. সমাপ্তি');

  // Verify running headers were not added as entries
  assert.ok(!result.tree.some((item) => item.title.includes('চলমান')));
  assert.ok(!result.tree.some((item) => item.title.includes('শেষ অংশ')));
  console.log('  ✓ Test Case 3 Passed: Multi-page continuous TOC correctly processed (15 entries).\n');
}

// ---------------------------------------------------------------------
// TEST CASE 4: No Original TOC (Strict Fallback Mode)
// ---------------------------------------------------------------------
{
  console.log('Test Case 4: No Original TOC (Strict Fallback Mode)...');

  const pages: PageItem[] = [
    createPage(1, '# রক্তকরবী\n\nরবীন্দ্রনাথ ঠাকুর'),
    createPage(2, '# ভূমিকা\n\nনাটকের উদ্দেশ্য ও প্রেক্ষাপট।'),
    createPage(3, '# প্রথম দৃশ্য\n\nযক্ষপুরীর পথ। নন্দিনী ও কিশোর।'),
    createPage(4, '# দ্বিতীয় দৃশ্য\n\nঅধ্যাপক ও নন্দিনী।'),
    createPage(5, '# উপসংহার\n\nনাটক সমাপ্ত।'),
  ];

  const result = extractAuthoritativeTocTree(pages);

  assert.equal(result.isFallback, true, 'Expected fallback to be true when no TOC exists');
  assert.equal(result.diagnostics.fallbackUsed, true);
  assert.ok(result.diagnostics.fallbackReason, 'Expected clear fallback reason');
  assert.equal(result.tree.length, 5, 'Expected fallback to reconstruct 5 major headings');
  assert.equal(result.tree[0].title, 'রক্তকরবী');
  assert.equal(result.tree[1].title, 'ভূমিকা');
  assert.equal(result.tree[2].title, 'প্রথম দৃশ্য');

  console.log('  ✓ Test Case 4 Passed: Separated fallback strategy used with explicit diagnostics.\n');
}

// ---------------------------------------------------------------------
// TEST CASE 5: Repeated Headers & Footers on every page
// ---------------------------------------------------------------------
{
  console.log('Test Case 5: Repeated Headers & Footers excluded from TOC...');

  const tocWithHeaderFooter = `
রবীন্দ্রনাথ ঠাকুর — গীতাঞ্জলি
# সূচিপত্র

১. প্রার্থনা ..................... ৫
২. গান ........................... ১০
৩. নিবেদন ........................ ১৫

www.amarboi.com | পৃষ্ঠা ২
`;

  const pages: PageItem[] = [
    createPage(1, 'রবীন্দ্রনাথ ঠাকুর — গীতাঞ্জলি\n# কভার\nপৃষ্ঠা ১'),
    createPage(2, tocWithHeaderFooter, true),
    createPage(3, 'রবীন্দ্রনাথ ঠাকুর — গীতাঞ্জলি\n# প্রার্থনা\nআমার মাথা নত করে দাও...\nপৃষ্ঠা ৩'),
  ];

  const result = extractAuthoritativeTocTree(pages);

  assert.equal(result.tree.length, 3, 'Only genuine entries should be in TOC');
  assert.ok(
    !result.tree.some((t) => t.title.includes('রবীন্দ্রনাথ ঠাকুর') || t.title.includes('amarboi')),
    'Running headers and watermark footers must not appear in TOC'
  );
  console.log('  ✓ Test Case 5 Passed: Headers and footers excluded cleanly.\n');
}

// ---------------------------------------------------------------------
// TEST CASE 6: Scanned PDF / Uncertain extraction rejection
// ---------------------------------------------------------------------
{
  console.log('Test Case 6: Scanned PDF noise rejected without hallucinating entries...');

  const noisyToc = `
# সূচিপত্র

১. প্রথম অধ্যায় ................ ১২
২. দ্বিতীয় অধ্যায় .............. ২৪
.. . .. .. .
!@#$ ???
খ ১
— — —
৩. তৃতীয় অধ্যায় ................ ৩৬
`;

  const pages: PageItem[] = [
    createPage(1, 'স্ক্যানার পাতা'),
    createPage(2, noisyToc, true),
    createPage(3, '# প্রথম অধ্যায়\nকাহিনী।'),
  ];

  const result = extractAuthoritativeTocTree(pages);

  assert.equal(result.tree.length, 3, 'Only the 3 verified chapter entries should survive');
  assert.ok(
    !result.tree.some((t) => t.title.includes('!@#$') || t.title.includes('???')),
    'Noise and punctuation garbage must be rejected'
  );
  assert.ok(result.diagnostics.rejectedCount > 0, 'Rejected count must record filtered lines');
  console.log('  ✓ Test Case 6 Passed: Noisy OCR artifacts safely rejected.\n');
}

// ---------------------------------------------------------------------
// TEST CASE 7: Multilingual Book (French, German, Hindi, Arabic labels)
// ---------------------------------------------------------------------
{
  console.log('Test Case 7: Multilingual Book support...');

  // German
  assert.equal(isTableOfContentsLabel('Inhaltsverzeichnis'), true);
  assert.equal(isTableOfContentsLabel('Inhalt'), true);

  // French
  assert.equal(isTableOfContentsLabel('Table des matières'), true);
  assert.equal(isTableOfContentsLabel('Sommaire'), true);

  // Hindi
  assert.equal(isTableOfContentsLabel('विषय-सूची'), true);
  assert.equal(isTableOfContentsLabel('अनुक्रमणिका'), true);

  // Arabic
  assert.equal(isTableOfContentsLabel('الفهرس'), true);

  const frenchToc = `
# Table des matières

Chapitre I: L'Aurore ................. 12
Chapitre II: Le Voyage ................ 34
Chapitre III: La Découverte ........... 56
`;

  const frenchPages: PageItem[] = [
    createPage(1, '# Le Petit Prince'),
    createPage(2, frenchToc),
    createPage(3, '# Chapitre I: L\'Aurore\nTexte du chapitre.'),
  ];

  const result = extractAuthoritativeTocTree(frenchPages);
  assert.equal(result.isFallback, false);
  assert.equal(result.tree.length, 3);
  assert.equal(result.tree[0].title, "Chapitre I: L'Aurore");
  assert.equal(result.tree[2].title, "Chapitre III: La Découverte");
  console.log('  ✓ Test Case 7 Passed: Multilingual labels and accents preserved.\n');
}

// ---------------------------------------------------------------------
// TEST CASE 8: Duplicate Headings handling
// ---------------------------------------------------------------------
{
  console.log('Test Case 8: Duplicate Headings handled cleanly without false duplication...');

  const tocWithDupes = `
# সূচিপত্র

১. পরিচিতি .................... ৫
১. পরিচিতি .................... ৫
২. মূল ভাবনা ................... ১০
৩. উপসংহার .................... ২০
`;

  const pages: PageItem[] = [
    createPage(1, '# বই'),
    createPage(2, tocWithDupes, true),
    createPage(3, '# পরিচিতি\nতথ্য।'),
  ];

  const result = extractAuthoritativeTocTree(pages);

  assert.equal(result.tree.length, 3, 'Duplicate entry on TOC page should be deduplicated');
  assert.equal(result.diagnostics.duplicatesRemovedCount, 1);
  console.log('  ✓ Test Case 8 Passed: Accidental duplicate entries cleanly deduplicated.\n');
}

// ---------------------------------------------------------------------
// TEST CASE 9: EPUB Navigation Document Generation (EPUB 3 nav & EPUB 2 NCX)
// ---------------------------------------------------------------------
{
  console.log('Test Case 9: EPUB Navigation generation and package manifest validation...');

  const pages: PageItem[] = [
    createPage(1, '# সোনার তরী\nরবীন্দ্রনাথ ঠাকুর'),
    createPage(
      2,
      `# সূচিপত্র\n১. সোনার তরী ........ ১০\n২. হিং টিং ছট ........ ২৫\n৩. পরশপাথর .......... ৪০`,
      true
    ),
    createPage(3, '# সোনার তরী\nগগনে গরজে মেঘ, ঘন বরষা।'),
    createPage(4, '# হিং টিং ছট\nস্বপ্নে মগ্ন ছিল রাজা হবুচন্দ্র।'),
    createPage(5, '# পরশপাথর\nখেপা খুঁজে খুঁজে ফেরে পরশপাথর।'),
  ];

  const bookDetails: BookDetails = {
    title: 'সোনার তরী',
    author: 'রবীন্দ্রনাথ ঠাকুর',
    publisher: 'বিশ্বভারতী',
    genre: 'কবিতা',
    publishYear: '১৮৯৪',
  };

  const { blob, filename, diagnostics } = await generateEpubBlob(bookDetails, pages, null, 'noto');

  assert.ok(blob, 'Blob must be created');
  assert.ok(filename.endsWith('.epub'), 'Filename must end with .epub');
  assert.ok(diagnostics, 'Diagnostics must be returned');
  assert.equal(diagnostics?.validatedEntriesCount, 3);

  const arrayBuffer = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. mimetype must be uncompressed STORE
  const mimetypeFile = zip.file('mimetype');
  assert.ok(mimetypeFile, 'mimetype file must exist');

  // 2. OEBPS/nav.xhtml must exist and have epub:type="toc"
  const navFile = zip.file('OEBPS/nav.xhtml');
  assert.ok(navFile, 'OEBPS/nav.xhtml must exist');
  const navContent = await navFile.async('text');
  assert.ok(navContent.includes('epub:type="toc"'), 'nav.xhtml must contain epub:type="toc"');
  assert.ok(navContent.includes('সোনার তরী'), 'nav.xhtml must contain chapter title');
  assert.ok(
    navContent.includes('page_3.xhtml') || navContent.includes('page_'),
    'nav.xhtml must link to content pages'
  );

  // 3. OEBPS/toc.ncx must exist and have navPoints
  const ncxFile = zip.file('OEBPS/toc.ncx');
  assert.ok(ncxFile, 'OEBPS/toc.ncx must exist');
  const ncxContent = await ncxFile.async('text');
  assert.ok(ncxContent.includes('<navPoint'), 'toc.ncx must contain navPoints');

  // 4. Verify no debugging or confidence text leaked into EPUB files
  assert.ok(!navContent.includes('diagnostics'), 'nav.xhtml must not contain debug text');
  assert.ok(!ncxContent.includes('confidence'), 'toc.ncx must not contain internal confidence data');

  // 5. CRITICAL: Verify EXACTLY ONE Table of Contents in EPUB spine!
  const opfFile = zip.file('OEBPS/content.opf');
  assert.ok(opfFile, 'content.opf must exist');
  const opfContent = await opfFile.async('text');

  // Must have toc-view in spine
  assert.ok(opfContent.includes('<itemref idref="toc-view"/>'), 'content.opf must include toc-view in spine');
  const tocMatches = opfContent.match(/<itemref idref="toc-view"\/>/g) || [];
  assert.equal(tocMatches.length, 1, 'toc-view must appear exactly once in the spine');

  // Original TOC page (page 2) must NOT be in the spine as a second TOC
  assert.ok(
    !opfContent.includes('<itemref idref="page_2"/>'),
    'Original TOC page (page_2) must NOT be in spine as duplicate visible page'
  );

  // Content pages must remain in the spine
  assert.ok(opfContent.includes('<itemref idref="page_1"/>'), 'page_1 must be in spine');
  assert.ok(opfContent.includes('<itemref idref="page_3"/>'), 'page_3 (Chapter 1) must be in spine');
  assert.ok(opfContent.includes('<itemref idref="page_4"/>'), 'page_4 (Chapter 2) must be in spine');
  assert.ok(opfContent.includes('<itemref idref="page_5"/>'), 'page_5 (Chapter 3) must be in spine');

  console.log('  ✓ Test Case 9 Passed: Exactly ONE visible TOC in EPUB spine, duplicate TOC prevented.\n');
}

// ---------------------------------------------------------------------
// TEST CASE 10: Empty or Unreadable TOC (Graceful handling)
// ---------------------------------------------------------------------
{
  console.log('Test Case 10: Empty or Unreadable TOC gracefully handled...');

  const pagesWithEmpty: PageItem[] = [
    createPage(1, ''),
    createPage(2, '   \n\n   '),
    createPage(3, '# প্রথম অধ্যায়\nকিছু কথা।'),
  ];

  const result = extractAuthoritativeTocTree(pagesWithEmpty);
  assert.ok(result, 'Result should be returned without throwing');
  assert.equal(result.isFallback, true);
  assert.ok(result.tree.length >= 1, 'Should produce safe fallback landmark');
  console.log('  ✓ Test Case 10 Passed: Empty/unreadable input handled gracefully.\n');
}

// ---------------------------------------------------------------------
// TEST CASE 11: Multi-Page Original TOC Prevention of Duplication
// ---------------------------------------------------------------------
{
  console.log('Test Case 11: Multi-Page TOC (pages 2, 3) produces exactly ONE visible TOC in EPUB...');

  const pages: PageItem[] = [
    createPage(1, '# বই\nলেখক'),
    createPage(2, '# সূচিপত্র\n১. অধ্যায় ১ .......... ১০\n২. অধ্যায় ২ .......... ২০'),
    createPage(3, 'সূচিপত্র (চলমান)\n৩. অধ্যায় ৩ .......... ৩০\n৪. অধ্যায় ৪ .......... ৪০'),
    createPage(4, '# অধ্যায় ১\nমূল কন্টেন্ট।'),
    createPage(5, '# অধ্যায় ২\nআরও কন্টেন্ট।'),
  ];

  const bookDetails: BookDetails = {
    title: 'মাল্টিপেজ বই',
    author: 'লেখক',
    publisher: 'প্রকাশক',
    genre: 'প্রবন্ধ',
  };
  const { blob } = await generateEpubBlob(bookDetails, pages);

  const arrayBuffer = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const opfContent = await zip.file('OEBPS/content.opf')!.async('text');

  // Verify only one TOC in spine
  const tocViewCount = (opfContent.match(/<itemref idref="toc-view"\/>/g) || []).length;
  assert.equal(tocViewCount, 1, 'toc-view must appear exactly once');

  // Neither page_2 nor page_3 should be in spine
  assert.ok(!opfContent.includes('<itemref idref="page_2"/>'), 'page_2 must not be in spine');
  assert.ok(!opfContent.includes('<itemref idref="page_3"/>'), 'page_3 must not be in spine');

  // Content pages must be in spine
  assert.ok(opfContent.includes('<itemref idref="page_4"/>'), 'page_4 must be in spine');
  assert.ok(opfContent.includes('<itemref idref="page_5"/>'), 'page_5 must be in spine');

  console.log('  ✓ Test Case 11 Passed: Multi-page TOC consolidated into single TOC, no duplicates in spine.\n');
}

// ---------------------------------------------------------------------
// TEST CASE 12: Legitimate Content Chapter with "সূচিপত্র" Preserved
// ---------------------------------------------------------------------
{
  console.log('Test Case 12: Legitimate chapter mentioning "সূচিপত্র" in title is NOT removed...');

  const pages: PageItem[] = [
    createPage(1, '# ভূমিকা\nবইয়ের সূচনা।'),
    createPage(2, '# সূচিপত্র ও গবেষণা\nএটি আধুনিক বাংলা সাহিত্যের সূচিপত্র নিয়ে একটি পর্যালোচনা।'),
    createPage(3, '# উপসংহার\nশেষ কথা।'),
  ];

  const bookDetails: BookDetails = {
    title: 'গবেষণা বই',
    author: 'গবেষক',
    publisher: 'প্রকাশক',
    genre: 'গবেষণা',
  };
  const { blob } = await generateEpubBlob(bookDetails, pages);

  const arrayBuffer = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const opfContent = await zip.file('OEBPS/content.opf')!.async('text');

  // Page 2 is a legitimate chapter (not a TOC page) - it must be in the spine!
  assert.ok(opfContent.includes('<itemref idref="page_2"/>'), 'Legitimate chapter page_2 must be preserved in spine');
  assert.ok(opfContent.includes('<itemref idref="page_1"/>'), 'page_1 must be in spine');
  assert.ok(opfContent.includes('<itemref idref="page_3"/>'), 'page_3 must be in spine');

  console.log('  ✓ Test Case 12 Passed: Legitimate chapter containing "সূচিপত্র" correctly preserved in spine.\n');
}

// ---------------------------------------------------------------------
// REGRESSION TEST A: Bengali Price / Ingredient List (False Positive Prevention)
// ---------------------------------------------------------------------
{
  console.log('Regression Test A: Bengali Price / Ingredient List ("শস্য এবং ডাল", "মাখন ও চিনি ইত্যাদি")...');

  const bengaliIngredientPageMarkdown = [
    '# শস্য এবং ডাল',
    'চাল — ৫০',
    'গম — ৪০',
    'মসুর ডাল — ৬০',
    'ছোলার ডাল — ৫৫',
    'মুগ ডাল — ১ কেজি ৭০ টাকা',
    '',
    '# মাখন ও চিনি ইত্যাদি',
    'মাখন — ২৫০ গ্রাম ১২০',
    'চিনি — ২ সের ৮০',
    'লবণ — ২০',
    'সরিষার তেল — ৫০০ মিলি ৯০',
  ].join('\n');

  // Even if previously stamped isTocPage=true by legacy code, it must be rejected as a TOC
  const pages: PageItem[] = [
    createPage(1, '# প্রথম অধ্যায়: মুঘল রন্ধনশালা\nবাদশাহী রন্ধনশালার বাজার ও উপকরণের বিবরণ নিচে দেওয়া হলো।'),
    createPage(2, bengaliIngredientPageMarkdown, true),
    createPage(3, '# দ্বিতীয় অধ্যায়: রাজকীয় ভোজ\nভোজসভার আয়োজন ও পরিবেশন পদ্ধতি।'),
  ];

  assert.equal(isOrdinaryDataListPage(bengaliIngredientPageMarkdown), true, 'Must detect page as ordinary data/ingredient list');
  assert.equal(isTableOfContentsText(bengaliIngredientPageMarkdown), false, 'isTableOfContentsText must return false for Bengali price/ingredient list');
  assert.equal(isLikelyTocPage(pages[1], pages), false, 'isLikelyTocPage must return false for Bengali price/ingredient list');
  assert.deepEqual(detectTocPages(pages), [], 'detectTocPages must NOT include the ingredient list page');

  const tocResult = extractAuthoritativeTocTree(pages);
  assert.deepEqual(tocResult.tocPages, [], 'No TOC pages should be recorded');
  assert.deepEqual(tocResult.diagnostics.identifiedTocPages, [], 'No identifiedTocPages should be recorded in diagnostics');

  const tocTitles = tocResult.tree.map((item) => item.title);
  assert.ok(!tocTitles.some((t) => t.includes('শস্য এবং ডাল')), 'Category heading "শস্য এবং ডাল" must NOT become a TOC entry');
  assert.ok(!tocTitles.some((t) => t.includes('মাখন ও চিনি ইত্যাদি')), 'Category heading "মাখন ও চিনি ইত্যাদি" must NOT become a TOC entry');
  assert.ok(!tocTitles.some((t) => t.includes('চাল') || t.includes('মসুর ডাল')), 'Ingredient items must NOT become TOC entries');

  // Verify markdownToXhtml does not turn lines into toc-list/toc-link
  const renderedBodyXhtml = markdownToXhtml(bengaliIngredientPageMarkdown, [], {
    pageNumber: 2,
    isTocPage: false,
    allPages: pages,
  });
  assert.ok(!renderedBodyXhtml.includes('toc-list'), 'markdownToXhtml must NOT generate toc-list for ordinary list page');
  assert.ok(!renderedBodyXhtml.includes('toc-link'), 'markdownToXhtml must NOT generate toc-link for ordinary list page');
  assert.ok(renderedBodyXhtml.includes('শস্য এবং ডাল'), 'Original heading "শস্য এবং ডাল" must be preserved');
  assert.ok(renderedBodyXhtml.includes('মাখন ও চিনি ইত্যাদি'), 'Original heading "মাখন ও চিনি ইত্যাদি" must be preserved');
  assert.ok(renderedBodyXhtml.includes('চাল — ৫০'), 'First ingredient line "চাল — ৫০" must not be stripped');
  assert.ok(renderedBodyXhtml.includes('সরিষার তেল — ৫০০ মিলি ৯০'), 'Last ingredient line must not be stripped');

  // Verify full EPUB generation preserves page 2 in spine with all content intact
  const bookDetails: BookDetails = {
    title: 'বাদশাহী রন্ধনশালা',
    author: 'ঐতিহাসিক লেখক',
    publisher: 'প্রকাশনী',
    genre: 'ইতিহাস',
  };
  const { blob } = await generateEpubBlob(bookDetails, pages);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const opfContent = await zip.file('OEBPS/content.opf')!.async('text');
  assert.ok(opfContent.includes('<itemref idref="page_2"/>'), 'Ingredient list page_2 MUST remain in the EPUB spine');

  const page2Xhtml = await zip.file('OEBPS/page_2.xhtml')!.async('text');
  assert.ok(page2Xhtml.includes('শস্য এবং ডাল'), 'EPUB page_2.xhtml must contain "শস্য এবং ডাল"');
  assert.ok(page2Xhtml.includes('মাখন ও চিনি ইত্যাদি'), 'EPUB page_2.xhtml must contain "মাখন ও চিনি ইত্যাদি"');
  assert.ok(page2Xhtml.includes('চাল — ৫০'), 'EPUB page_2.xhtml must contain "চাল — ৫০"');
  assert.ok(!page2Xhtml.includes('class="toc-link"'), 'EPUB page_2.xhtml must not contain TOC links');

  console.log('  ✓ Regression Test A Passed: Bengali price/ingredient list preserved as content and excluded from TOC.\n');
}

// ---------------------------------------------------------------------
// REGRESSION TEST B: English Product Catalog
// ---------------------------------------------------------------------
{
  console.log('Regression Test B: English Product Catalog...');

  const catalogMarkdown = [
    '# Grains and Pulses',
    'Basmati Rice 1 kg — 120',
    'Whole Wheat Flour 2 kg — 95',
    'Red Lentils 500 g — 65',
    'Chickpeas — 80',
    '',
    '# Butter and Sugar etc.',
    'Salted Butter 250 gm — 150',
    'Refined Sugar 1 kg — 55',
    'Mustard Oil 500 ml — 110',
  ].join('\n');

  const pages: PageItem[] = [
    createPage(1, '# Chapter 1: Royal Kitchen Supplies\nOverview of pantry provisions.'),
    createPage(2, catalogMarkdown),
    createPage(3, '# Chapter 2: Preparation Methods\nDetailed cooking procedures.'),
  ];

  assert.equal(isTableOfContentsText(catalogMarkdown), false, 'English product catalog must not be classified as TOC text');
  assert.equal(isLikelyTocPage(pages[1], pages), false, 'English product catalog must not be classified as TOC page');
  assert.deepEqual(detectTocPages(pages), [], 'detectTocPages must return empty for English catalog');

  const { blob } = await generateEpubBlob(
    { title: 'Royal Provisions', author: 'Chef', publisher: 'Press', genre: 'Reference' },
    pages
  );
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const opfContent = await zip.file('OEBPS/content.opf')!.async('text');
  assert.ok(opfContent.includes('<itemref idref="page_2"/>'), 'Catalog page_2 must be preserved in EPUB spine');
  const page2Xhtml = await zip.file('OEBPS/page_2.xhtml')!.async('text');
  assert.ok(page2Xhtml.includes('Basmati Rice 1 kg — 120'), 'Catalog items must be intact in page_2.xhtml');

  console.log('  ✓ Regression Test B Passed: English product catalog preserved as ordinary content.\n');
}

// ---------------------------------------------------------------------
// REGRESSION TEST C: Genuine Bengali TOC
// ---------------------------------------------------------------------
{
  console.log('Regression Test C: Genuine Bengali TOC...');

  const pages: PageItem[] = [
    createPage(1, '# সূচিপত্র\nপ্রথম অধ্যায় — ১০\nদ্বিতীয় অধ্যায় — ২৪\nতৃতীয় অধ্যায় — ৩৮\nউপসংহার — ৫২'),
    createPage(2, '# প্রথম অধ্যায়\nপ্রথম অধ্যায়ের বিস্তারিত আলোচনা।'),
    createPage(3, '# দ্বিতীয় অধ্যায়\nদ্বিতীয় অধ্যায়ের বিস্তারিত আলোচনা।'),
    createPage(4, '# তৃতীয় অধ্যায়\nতৃতীয় অধ্যায়ের বিস্তারিত আলোচনা।'),
    createPage(5, '# উপসংহার\nসমাপ্তি আলোচনা।'),
  ];

  assert.equal(isTableOfContentsText(pages[0].markdown), true, 'Genuine Bengali TOC must be detected');
  assert.deepEqual(detectTocPages(pages), [1], 'Page 1 must be detected as TOC page');

  const res = extractAuthoritativeTocTree(pages);
  assert.equal(res.isFallback, false, 'Genuine Bengali TOC must not fall back');
  assert.equal(res.tree.length, 4, 'All 4 Bengali TOC entries must be extracted');
  assert.equal(res.tree[0].targetPageNumber, 2);
  assert.ok(res.tree[0].targetHref.startsWith('page_2.xhtml#toc-h-p2-1'), 'Must link to page_2 heading anchor');
  assert.equal(res.tree[3].targetPageNumber, 5);
  assert.ok(res.tree[3].targetHref.startsWith('page_5.xhtml#toc-h-p5-1'), 'Must link to page_5 heading anchor');

  console.log('  ✓ Regression Test C Passed: Genuine Bengali TOC detected and linked accurately.\n');
}

// ---------------------------------------------------------------------
// REGRESSION TEST D: Genuine English TOC
// ---------------------------------------------------------------------
{
  console.log('Regression Test D: Genuine English TOC...');

  const pages: PageItem[] = [
    createPage(1, '# Table of Contents\nChapter 1: The Awakening .......... 5\nChapter 2: The Journey .......... 18\nChapter 3: The Return .......... 32'),
    createPage(2, '# Chapter 1: The Awakening\nContent of chapter 1.'),
    createPage(3, '# Chapter 2: The Journey\nContent of chapter 2.'),
    createPage(4, '# Chapter 3: The Return\nContent of chapter 3.'),
  ];

  assert.equal(isTableOfContentsText(pages[0].markdown), true, 'Genuine English TOC must be detected');
  assert.deepEqual(detectTocPages(pages), [1], 'Page 1 must be detected as English TOC page');

  const res = extractAuthoritativeTocTree(pages);
  assert.equal(res.isFallback, false);
  assert.equal(res.tree.length, 3);
  assert.equal(res.tree[0].targetPageNumber, 2);
  assert.ok(res.tree[0].targetHref.startsWith('page_2.xhtml#toc-h-p2-1'));

  console.log('  ✓ Regression Test D Passed: Genuine English TOC detected and linked accurately.\n');
}

// ---------------------------------------------------------------------
// REGRESSION TEST E: Unlabelled Genuine TOC
// ---------------------------------------------------------------------
{
  console.log('Regression Test E: Unlabelled Genuine TOC in Front Matter...');

  const unlabelledTocMarkdown = [
    'প্রথম অধ্যায়: বঙ্গদেশের ভূপ্রকৃতি .......... ১',
    'দ্বিতীয় অধ্যায়: প্রাচীন জনপদ .......... ১৫',
    'তৃতীয় অধ্যায়: নদী ও বন্দর .......... ২৮',
    'চতুর্থ অধ্যায়: স্থাপত্য ও শিল্পকলা .......... ৪২',
    'উপসংহার .......... ৫৬',
  ].join('\n');

  const pages: PageItem[] = [
    createPage(1, '# বঙ্গদেশের ইতিহাস\nলেখক: ড. রমেশচন্দ্র'),
    createPage(2, unlabelledTocMarkdown),
    createPage(3, '# প্রথম অধ্যায়: বঙ্গদেশের ভূপ্রকৃতি\nবঙ্গদেশের ভূপ্রকৃতি অতি বৈচিত্র্যময়।'),
    createPage(4, '# দ্বিতীয় অধ্যায়: প্রাচীন জনপদ\nপ্রাচীনকালে পুণ্ড্র, বঙ্গ ও সমতট জনপদ ছিল।'),
    createPage(5, '# তৃতীয় অধ্যায়: নদী ও বন্দর\nগঙ্গা ও ব্রহ্মপুত্রের অববাহিকায় বন্দর গড়ে ওঠে।'),
    createPage(6, '# চতুর্থ অধ্যায়: স্থাপত্য ও শিল্পকলা\nপোড়ামাটির ফলক ও বিহার স্থাপত্য।'),
    createPage(7, '# উপসংহার\nইতিহাসের ধারাবাহিকতা।'),
  ];

  assert.deepEqual(detectTocPages(pages), [2], 'Unlabelled genuine TOC with leader dots, chapter keywords, monotonic pages, and heading matches must be detected');
  const res = extractAuthoritativeTocTree(pages);
  assert.equal(res.isFallback, false, 'Unlabelled genuine TOC must extract authoritative tree');
  assert.equal(res.tree.length, 5, 'Should extract all 5 chapter entries');
  assert.equal(res.tree[0].targetPageNumber, 3);
  assert.ok(res.tree[0].targetHref.startsWith('page_3.xhtml#toc-h-p3-1'));

  console.log('  ✓ Regression Test E Passed: Unlabelled genuine TOC recognized when multi-signal evidence exceeds conservative threshold.\n');
}

// ---------------------------------------------------------------------
// REGRESSION TEST F: Numeric Ordinary List (Non-Monotonic / No Chapter Signals)
// ---------------------------------------------------------------------
{
  console.log('Regression Test F: Numeric Ordinary List without Chapter Structure...');

  const numericListMarkdown = [
    'উত্তরবঙ্গ — ৪৫',
    'দক্ষিণবঙ্গ — ১৮',
    'মধ্যাঞ্চল — ৬২',
    'পশ্চিমাঞ্চল — ২৯',
    'পূর্বাঞ্চল — ৫১',
    'পার্বত্য অঞ্চল — ১২',
  ].join('\n');

  const pages: PageItem[] = [
    createPage(1, '# প্রথম অধ্যায়: জনসংখ্যা ও পরিসংখ্যান\nবিভিন্ন অঞ্চলের কেন্দ্রের সংখ্যা নিচে দেওয়া হলো।'),
    createPage(2, numericListMarkdown),
    createPage(3, '# দ্বিতীয় অধ্যায়: বিশ্লেষণ\nপরিসংখ্যানের বিশ্লেষণ।'),
  ];

  assert.equal(isTableOfContentsText(numericListMarkdown), false, 'Numeric ordinary list with fluctuating numbers must NOT be classified as TOC');
  assert.deepEqual(detectTocPages(pages), [], 'detectTocPages must NOT classify numeric ordinary list as TOC');

  console.log('  ✓ Regression Test F Passed: Numeric ordinary list rejected as TOC.\n');
}

// ---------------------------------------------------------------------
// REGRESSION TEST G: Ambiguous Content (Short Lines & Numbers)
// ---------------------------------------------------------------------
{
  console.log('Regression Test G: Ambiguous Content Preserved Without Speculative Links...');

  const ambiguousMarkdown = [
    'রহিম — ১০',
    'করিম — ১২',
    'যদু — ১৫',
  ].join('\n');

  const pages: PageItem[] = [
    createPage(1, '# প্রথম পরিচ্ছেদ\nগ্রামের হিসাব খাতা।'),
    createPage(2, ambiguousMarkdown),
    createPage(3, '# দ্বিতীয় পরিচ্ছেদ\nপরবর্তী ঘটনা।'),
  ];

  assert.equal(isTableOfContentsText(ambiguousMarkdown), false, 'Ambiguous short numeric lines must NOT be classified as TOC');
  assert.deepEqual(detectTocPages(pages), [], 'detectTocPages must return empty for ambiguous content');

  const tocRes = extractAuthoritativeTocTree(pages);
  assert.ok(!tocRes.tree.some((item) => item.title.includes('রহিম')), 'No speculative TOC links may be generated from ambiguous content');

  const { blob } = await generateEpubBlob(
    { title: 'গ্রামের খাতা', author: 'লেখক', publisher: 'প্রকাশক', genre: 'গল্প' },
    pages
  );
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const page1Xhtml = await zip.file('OEBPS/page_1.xhtml')!.async('text');
  const page2File = zip.file('OEBPS/page_2.xhtml');
  const combinedXhtml = page1Xhtml + (page2File ? await page2File.async('text') : '');
  assert.ok(combinedXhtml.includes('রহিম — ১০'), 'Ambiguous content "রহিম — ১০" must be preserved in EPUB');
  assert.ok(combinedXhtml.includes('করিম — ১২'), 'Ambiguous content "করিম — ১২" must be preserved in EPUB');
  assert.ok(!combinedXhtml.includes('class="toc-link"'), 'Ambiguous content must not be converted into TOC links');

  console.log('  ✓ Regression Test G Passed: Ambiguous content preserved in EPUB without speculative TOC links.\n');
}

// ---------------------------------------------------------------------
// REGRESSION TEST H: Existing EPUB Functionality (Cross-Page Continuation & Smart Spacing)
// ---------------------------------------------------------------------
{
  console.log('Regression Test H: Existing EPUB Functionality (Smart Spacing & Cross-Page Continuation)...');

  const pages: PageItem[] = [
    createPage(1, '# সূচিপত্র\nপ্রথম অধ্যায় — ২'),
    createPage(
      2,
      '# প্রথম অধ্যায়\n\nএটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য'
    ),
    createPage(
      3,
      'উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে।'
    ),
  ];

  const { blob, layoutReport } = await generateEpubBlob(
    { title: 'মুঘল ইতিহাস', author: 'লেখক', publisher: 'প্রকাশক', genre: 'ইতিহাস' },
    pages,
    undefined,
    undefined,
    { smartSpacing: true }
  );

  assert.ok(layoutReport, 'Layout report must be generated');
  assert.equal(layoutReport!.crossPageParagraphsMerged, 1, 'Cross-page paragraph continuation must still merge seamlessly');

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const page2Xhtml = await zip.file('OEBPS/page_2.xhtml')!.async('text');
  assert.ok(
    page2Xhtml.includes('এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে।'),
    'Merged continuous paragraph must appear in page_2.xhtml with a single space'
  );

  console.log('  ✓ Regression Test H Passed: Existing Smart Spacing, paragraph continuation, and EPUB export unaffected.\n');
}

// =====================================================================
// STEP 5: TOC NAVIGATION & ANCHOR ACCURACY REGRESSION TESTS (A - G)
// =====================================================================

// ---------------------------------------------------------------------
// TOC FIX TEST A: Consolidated Multi-Page XHTML Preserves Per-Page Heading Anchors
// ---------------------------------------------------------------------
{
  console.log('TOC Fix Test A: Consolidated Multi-Page XHTML Preserves Per-Page Heading Anchors (p12, p13, p14)...');

  const pages: PageItem[] = [
    createPage(1, '# সূচিপত্র\nপ্রথম অধ্যায়: মুঘল সাম্রাজ্যের সূচনা — ১২\n  ১.১ পানিপথের প্রথম যুদ্ধ — ১৩\n  ১.২ খানুয়ার যুদ্ধ ও রাজপুত নীতি — ১৪\nদ্বিতীয় অধ্যায়: হুমায়ুনের শাসনকাল — ১৫', true),
    ...Array.from({ length: 10 }, (_, idx) => createPage(idx + 2, `ভূমিকা ও প্রাক্-কথন পৃষ্ঠা ${idx + 2}।\n${ idx + 2 }`)),
    createPage(12, '# প্রথম অধ্যায়: মুঘল সাম্রাজ্যের সূচনা\n\n১৫২৬ খ্রিস্টাব্দে ভারতবর্ষের ইতিহাসে এক নতুন যুগের সূচনা হয়।\n১২'),
    createPage(13, 'এই অধ্যায়ে বাবরের সামরিক কৌশল আলোচিত হয়েছে।\n\n## ১.১ পানিপথের প্রথম যুদ্ধ\n\nইব্রাহিম লোদীর বিরুদ্ধে বাবরের কামান ও তুলুগমা কৌশল ব্যবহৃত হয়।\n১৩'),
    createPage(14, 'যুদ্ধের পরবর্তী ঘটনাপ্রবাহ নিচে দেওয়া হলো।\n\n## ১.২ খানুয়ার যুদ্ধ ও রাজপুত নীতি\n\nরানা সংগের বিরুদ্ধে খানুয়ার প্রান্তরে ঐতিহাসিক যুদ্ধ সংঘটিত হয়।\n১৪'),
    createPage(15, '# দ্বিতীয় অধ্যায়: হুমায়ুনের শাসনকাল\n\nবাবরের মৃত্যুর পর হুমায়ুন সিংহাসনে আরোহণ করেন।\n১৫'),
  ];

  const { blob } = await generateEpubBlob(
    { title: 'মুঘল সাম্রাজ্যের ইতিহাস', author: 'ড. করিম', publisher: 'ঐতিহ্য', genre: 'ইতিহাস' },
    pages,
    undefined,
    undefined,
    { smartSpacing: true }
  );

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const page12Xhtml = await zip.file('OEBPS/page_12.xhtml')!.async('text');
  const tocXhtml = await zip.file('OEBPS/toc.xhtml')!.async('text');

  // Verify consolidated page boundary anchors exist in page_12.xhtml
  assert.ok(page12Xhtml.includes('id="page_13"'), 'Consolidated page_12.xhtml must contain <span id="page_13">');
  assert.ok(page12Xhtml.includes('id="page_14"'), 'Consolidated page_12.xhtml must contain <span id="page_14">');

  // Verify per-page heading anchors use p12, p13, p14 (not all p12!)
  assert.ok(page12Xhtml.includes('id="toc-h-p12-1-'), 'Chapter heading on p12 must have id="toc-h-p12-1-..."');
  assert.ok(page12Xhtml.includes('id="toc-h-p13-1-'), 'Subheading on consolidated p13 must retain id="toc-h-p13-1-..."');
  assert.ok(page12Xhtml.includes('id="toc-h-p14-1-'), 'Subheading on consolidated p14 must retain id="toc-h-p14-1-..."');

  // Verify TOC links point to page_12.xhtml#toc-h-p13-1-... and page_12.xhtml#toc-h-p14-1-...
  assert.ok(tocXhtml.includes('href="page_12.xhtml#toc-h-p13-1-'), 'TOC link for 1.1 on p13 must target page_12.xhtml#toc-h-p13-1-...');
  assert.ok(tocXhtml.includes('href="page_12.xhtml#toc-h-p14-1-'), 'TOC link for 1.2 on p14 must target page_12.xhtml#toc-h-p14-1-...');

  console.log('  ✓ TOC Fix Test A Passed: Consolidated pages retain accurate p12/p13/p14 heading anchors and page_N spans.\n');
}

// ---------------------------------------------------------------------
// TOC FIX TEST B: End-of-Book "উপসংহার" Chapter Does Not Hijack to Early "উপসংহার" Subheading
// ---------------------------------------------------------------------
{
  console.log('TOC Fix Test B: End-of-Book "উপসংহার" Chapter Does Not Hijack to Early Subheading...');

  const pages: PageItem[] = [
    createPage(1, '# সূচিপত্র\nপ্রথম অধ্যায়: প্রাচীন বাংলা — ৫\nদ্বিতীয় অধ্যায়: মধ্যযুগের বাংলা — ১০\nতৃতীয় অধ্যায়: আধুনিক বাংলা — ১৫\nউপসংহার — ২০', true),
    createPage(2, 'প্রকাশকের কথা\n২'),
    createPage(3, 'লেখকের ভূমিকা\n৩'),
    createPage(4, 'কৃতজ্ঞতা স্বীকার\n৪'),
    createPage(5, '# প্রথম অধ্যায়: প্রাচীন বাংলা\nপ্রাচীন বাংলার জনপদসমূহের বিবরণ।\n১'),
    createPage(6, 'প্রাচীন বাংলার নদী ও বন্দর।\n\n## সংক্ষিপ্ত উপসংহার\nপ্রাচীন যুগের আলোচনার ইতি।\n২'),
    ...Array.from({ length: 3 }, (_, idx) => createPage(idx + 7, `প্রথম অধ্যায়ের ধারাবাহিক আলোচনা পৃষ্ঠা ${idx + 7}।\n${idx + 3}`)),
    createPage(10, '# দ্বিতীয় অধ্যায়: মধ্যযুগের বাংলা\nসুলতানি ও মুঘল আমলের বিবরণ।\n৬'),
    ...Array.from({ length: 4 }, (_, idx) => createPage(idx + 11, `দ্বিতীয় অধ্যায়ের ধারাবাহিক আলোচনা পৃষ্ঠা ${idx + 11}।\n${idx + 7}`)),
    createPage(15, '# তৃতীয় অধ্যায়: আধুনিক বাংলা\nআধুনিক যুগের সমাজ ও সংস্কৃতি।\n১১'),
    ...Array.from({ length: 4 }, (_, idx) => createPage(idx + 16, `তৃতীয় অধ্যায়ের ধারাবাহিক আলোচনা পৃষ্ঠা ${idx + 16}।\n${idx + 12}`)),
    createPage(20, '# সমাপ্তি ও উপসংহার\nসমগ্র গ্রন্থের সারসংক্ষেপ ও ঐতিহাসিক মূল্যায়ন।\n১৬'),
    ...Array.from({ length: 4 }, (_, idx) => createPage(idx + 21, `উপসংহারের পরবর্তী আলোচনা পৃষ্ঠা ${idx + 21}।\n${idx + 17}`)),
    createPage(24, '# গ্রন্থপঞ্জি\nতথ্যসূত্র ও সহায়ক গ্রন্থাবলি।\n২০'),
  ];

  const tocRes = extractAuthoritativeTocTree(pages);
  const uposongharNode = tocRes.tree.find((n) => n.title.includes('উপসংহার'));
  assert.ok(uposongharNode, 'TOC must include "উপসংহার" entry');
  assert.ok(
    uposongharNode!.targetPageNumber >= 20,
    `End-of-book "উপসংহার" must resolve near page 20/24 (got page ${uposongharNode!.targetPageNumber}), NEVER early subheading on page 6`
  );
  assert.notEqual(uposongharNode!.targetPageNumber, 6, 'Must NOT hijack to early subheading on page 6');

  console.log('  ✓ TOC Fix Test B Passed: End-of-book "উপসংহার" protected against early substring hijacking.\n');
}

// ---------------------------------------------------------------------
// TOC FIX TEST C: Bengali Unicode (য় vs য়, ZWJ/ZWNJ) & Chapter Prefix Variations Match Accurately
// ---------------------------------------------------------------------
{
  console.log('TOC Fix Test C: Bengali Unicode & Chapter Prefix Normalization...');

  // TOC uses "১. বাবরের ভারত অভিযান" (composed য় \u09DF)
  // Body uses "# প্রথম অধ্যায় : বাবরের\u200C ভারত অভিযান" (decomposed য় \u09AF\u09BC + ZWNJ + word ordinal prefix)
  const pages: PageItem[] = [
    createPage(1, '# সূচিপত্র\n১. বাবরের ভারত অভিযান — ৫\n২. শের শাহের সংস্কার — ৮', true),
    createPage(2, 'ভূমিকা পৃষ্ঠা ২'),
    createPage(3, 'ভূমিকা পৃষ্ঠা ৩'),
    createPage(4, 'ভূমিকা পৃষ্ঠা ৪'),
    createPage(5, '# প্রথম অধ\u09AF\u09BCায় : বাবরের\u200C ভারত অভিযান\n\nবাবরের ভারত অভিযানের বিস্তারিত বিবরণ।\n১'),
    createPage(6, 'বাবরের অভিযানের দ্বিতীয় অংশ।\n২'),
    createPage(7, 'বাবরের অভিযানের তৃতীয় অংশ।\n৩'),
    createPage(8, '# দ্বিতী\u09AF\u09BC অধ্যায় — শের\u200D শাহের সংস্কার\n\nশের শাহের ভূমি ও ডাক ব্যবস্থা সংস্কার।\n৪'),
  ];

  const tocRes = extractAuthoritativeTocTree(pages);
  assert.equal(tocRes.tree.length, 2, 'Should extract 2 chapters');
  assert.equal(tocRes.tree[0].targetPageNumber, 5, 'Chapter 1 with prefix/Unicode difference must resolve to page 5');
  assert.ok(tocRes.tree[0].anchorId?.startsWith('toc-h-p5-1-'), 'Chapter 1 must link to the exact heading anchor on page 5');
  assert.equal(tocRes.tree[1].targetPageNumber, 8, 'Chapter 2 with ZWNJ/ZWJ & decomposed য় must resolve to page 8');
  assert.ok(tocRes.tree[1].anchorId?.startsWith('toc-h-p8-1-'), 'Chapter 2 must link to the exact heading anchor on page 8');

  console.log('  ✓ TOC Fix Test C Passed: Non-destructive Bengali Unicode & prefix normalization resolves exact headings.\n');
}

// ---------------------------------------------------------------------
// TOC FIX TEST D: Excluded Target Page Does Not Falsely Fall Back to Page 1
// ---------------------------------------------------------------------
{
  console.log('TOC Fix Test D: Excluded TOC Target Page Resolves to Adjacent Chapter Window (Never Page 1)...');

  const pages: PageItem[] = [
    createPage(1, '# গ্রন্থের নাম\nলেখক পরিচিতি'),
    createPage(2, '# সূচিপত্র\nপ্রথম অধ্যায়: সূচনা পর্ব — ১\nদ্বিতীয় অধ্যায়: মধ্য পর্ব — ৫\nতৃতীয় অধ্যায়: সমাপ্তি পর্ব — ৯', true),
    createPage(5, '# প্রথম অধ্যায়: সূচনা পর্ব\nপ্রথম অধ্যায়ের মূল পাঠ্য।\n১'),
    createPage(6, 'প্রথম অধ্যায়ের ধারাবাহিক অংশ।\n২'),
    createPage(7, 'প্রথম অধ্যায়ের আরেকটি অংশ।\n৩'),
    createPage(8, 'প্রথম অধ্যায়ের শেষ অংশ।\n৪'),
    // Page 9 (printed page 5) was excluded by user (e.g. blank/illustration scan), chapter 2 starts on page 10
    {
      ...createPage(9, 'ফাঁকা অলঙ্করণ পৃষ্ঠা\n৫'),
      status: 'excluded',
    },
    createPage(10, '# দ্বিতীয় অধ্যায়: মধ্য পর্ব\nদ্বিতীয় অধ্যায়ের মূল পাঠ্য এখান থেকে শুরু।\n৬'),
    createPage(11, 'দ্বিতীয় অধ্যায়ের ধারাবাহিক অংশ।\n৭'),
    createPage(12, 'দ্বিতীয় অধ্যায়ের শেষ অংশ।\n৮'),
    createPage(13, '# তৃতীয় অধ্যায়: সমাপ্তি পর্ব\nতৃতীয় অধ্যায়ের মূল পাঠ্য।\n৯'),
  ];

  const validPages = pages.filter((p) => p.status !== 'excluded');
  const tocRes = extractAuthoritativeTocTree(validPages);
  const ch2 = tocRes.tree.find((n) => n.title.includes('দ্বিতীয় অধ্যায়'));
  assert.ok(ch2, 'Chapter 2 must exist in TOC tree');
  assert.notEqual(ch2!.targetPageNumber, 1, 'Excluded target page must NEVER fall back to page 1');
  assert.equal(ch2!.targetPageNumber, 10, 'Chapter 2 must resolve to page 10 in the adjacent chapter window');

  console.log('  ✓ TOC Fix Test D Passed: Excluded target page resolves to adjacent content page in chapter window.\n');
}

// ---------------------------------------------------------------------
// TOC FIX TEST E: Nested TOC Entries (Level 2/3/4) Preserve Exact Anchors After Consolidation
// ---------------------------------------------------------------------
{
  console.log('TOC Fix Test E: Nested TOC Entries (Level 2/3/4) Preserve Exact Anchors After Consolidation...');

  const pages: PageItem[] = [
    createPage(
      1,
      [
        '# সূচিপত্র',
        'প্রথম পর্ব: প্রাচীন যুগ — ২',
        '  প্রথম অধ্যায়: জনপদ — ৩',
        '    ১.১ পুণ্ড্রনগর — ৪',
        '      ১.১.১ মহাস্থানগড় শিলালিপি — ৫',
        '  দ্বিতীয় অধ্যায়: সমতট — ৬',
      ].join('\n'),
      true
    ),
    createPage(2, '# প্রথম পর্ব: প্রাচীন যুগ\nপ্রাচীন যুগের পটভূমি।\n২'),
    createPage(3, '# প্রথম অধ্যায়: জনপদ\nপ্রাচীন জনপদের বিবরণ।\n৩'),
    createPage(4, 'জনপদের বিস্তারিত আলোচনা।\n\n## ১.১ পুণ্ড্রনগর\nপুণ্ড্রনগরের ইতিহাস।\n৪'),
    createPage(5, 'পুণ্ড্রনগরের প্রত্নতত্ত্ব।\n\n### ১.১.১ মহাস্থানগড় শিলালিপি\nব্রাহ্মী লিপির নিদর্শন।\n৫'),
    createPage(6, '# দ্বিতীয় অধ্যায়: সমতট\nসমতট অঞ্চলের ইতিহাস।\n৬'),
  ];

  const { blob } = await generateEpubBlob(
    { title: 'প্রাচীন বাংলার জনপদ', author: 'ঐতিহাসিক', publisher: 'প্রকাশনী', genre: 'ইতিহাস' },
    pages,
    undefined,
    undefined,
    { smartSpacing: true }
  );

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const navXhtml = await zip.file('OEBPS/nav.xhtml')!.async('text');
  const page3Xhtml = await zip.file('OEBPS/page_3.xhtml')!.async('text');

  // Verify nested chapter 1 (page 3) was NOT merged into part 1 (page 2), and page 4 & 5 were consolidated into page_3.xhtml
  assert.ok(zip.file('OEBPS/page_3.xhtml'), 'Nested Chapter 1 under Part 1 must start its own chapter file page_3.xhtml');
  assert.ok(page3Xhtml.includes('id="toc-h-p4-1-'), 'Consolidated page_3.xhtml must contain Level-2 heading anchor on p4');
  assert.ok(page3Xhtml.includes('id="toc-h-p5-1-'), 'Consolidated page_3.xhtml must contain Level-3 heading anchor on p5');
  assert.ok(navXhtml.includes('href="page_3.xhtml#toc-h-p4-1-'), 'Nested Level-3 TOC link must point to page_3.xhtml#toc-h-p4-1-...');
  assert.ok(navXhtml.includes('href="page_3.xhtml#toc-h-p5-1-'), 'Nested Level-4 TOC link must point to page_3.xhtml#toc-h-p5-1-...');

  console.log('  ✓ TOC Fix Test E Passed: Nested TOC entries (Levels 2/3/4) retain exact consolidated anchors.\n');
}

// ---------------------------------------------------------------------
// TOC FIX TEST F: nav.xhtml, toc.xhtml, contents.xhtml, and toc.ncx Share 100% Identical Targets
// ---------------------------------------------------------------------
{
  console.log('TOC Fix Test F: nav.xhtml, toc.xhtml, contents.xhtml, and toc.ncx Target Consistency...');

  const pages: PageItem[] = [
    createPage(
      1,
      [
        '# সূচিপত্র',
        'প্রথম অধ্যায়: সূচনা — ২',
        '  ১.১ পটভূমি — ৩',
        'দ্বিতীয় অধ্যায়: বিস্তার — ৪',
      ].join('\n'),
      true
    ),
    createPage(2, '# প্রথম অধ্যায়: সূচনা\nসূচনা পর্বের আলোচনা।\n২'),
    createPage(3, 'ধারাবাহিক অংশ।\n\n## ১.১ পটভূমি\nপটভূমির বিস্তারিত বিবরণ।\n৩'),
    createPage(4, '# দ্বিতীয় অধ্যায়: বিস্তার\nদ্বিতীয় অধ্যায়ের আলোচনা।\n৪'),
  ];

  const { blob, validationReport } = await generateEpubBlob(
    { title: 'সামঞ্জস্য পরীক্ষা', author: 'লেখক', publisher: 'প্রকাশক', genre: 'প্রবন্ধ' },
    pages
  );

  assert.ok(validationReport?.isValid, 'Package validation report must pass with 0 errors');

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const navXhtml = await zip.file('OEBPS/nav.xhtml')!.async('text');
  const tocXhtml = await zip.file('OEBPS/toc.xhtml')!.async('text');
  const contentsXhtml = await zip.file('OEBPS/contents.xhtml')!.async('text');
  const tocNcx = await zip.file('OEBPS/toc.ncx')!.async('text');

  assert.equal(tocXhtml, contentsXhtml, 'toc.xhtml and contents.xhtml must be identical');

  // Extract TOC hrefs from nav.xhtml (inside <nav epub:type="toc">)
  const navTocBlock = navXhtml.split('<nav epub:type="landmarks"')[0];
  const navHrefs = Array.from(navTocBlock.matchAll(/<a\s+href="([^"]+)"/g)).map((m) => m[1]);
  const tocHrefs = Array.from(tocXhtml.matchAll(/<a\s+href="([^"]+)"\s+class="toc-link"/g)).map((m) => m[1]);
  const ncxSrcs = Array.from(tocNcx.matchAll(/<content\s+src="([^"]+)"\/>/g)).map((m) => m[1]);

  assert.equal(navHrefs.length, 3, 'Must have 3 TOC links');
  assert.deepEqual(navHrefs, tocHrefs, 'nav.xhtml and toc.xhtml must use identical href targets');
  assert.deepEqual(navHrefs, ncxSrcs, 'nav.xhtml and toc.ncx must use identical targets');

  // Verify every single target file and #fragment exists in the EPUB package
  for (const href of navHrefs) {
    const [file, hash] = href.split('#');
    const chapterFile = zip.file(`OEBPS/${file}`);
    assert.ok(chapterFile, `Target chapter file OEBPS/${file} must exist in EPUB`);
    if (hash) {
      const content = await chapterFile!.async('text');
      assert.ok(content.includes(`id="${hash}"`), `Target anchor id="${hash}" must exist in OEBPS/${file}`);
    }
  }

  console.log('  ✓ TOC Fix Test F Passed: nav.xhtml, toc.xhtml, contents.xhtml, and toc.ncx are 100% synchronized.\n');
}

// ---------------------------------------------------------------------
// TOC FIX TEST G: Running Headers Stripped Without Shifting Heading Counter
// ---------------------------------------------------------------------
{
  console.log('TOC Fix Test G: Stripped Running Headers Do Not Shift Heading Counter or Break TOC Anchors...');

  const pages: PageItem[] = [
    createPage(1, '# সূচিপত্র\nপ্রথম অধ্যায়: বাংলার নদী — ২\n  ১.১ পদ্মা নদীর কথা — ৩\nদ্বিতীয় অধ্যায়: বাংলার পাহাড় — ৪', true),
    createPage(2, 'বাংলার প্রকৃতি\n\n# প্রথম অধ্যায়: বাংলার নদী\nনদীমাতৃক বাংলাদেশের কথা।\n২'),
    createPage(3, 'বাংলার প্রকৃতি\n\nনদীর প্রবাহ।\n\n## ১.১ পদ্মা নদীর কথা\nপদ্মা নদীর বিস্তারিত বিবরণ।\n৩'),
    createPage(4, 'বাংলার প্রকৃতি\n\n# দ্বিতীয় অধ্যায়: বাংলার পাহাড়\nপাহাড়ি অঞ্চলের বিবরণ।\n৪'),
    createPage(5, 'বাংলার প্রকৃতি\n\nপাহাড়ের ধারাবাহিক বর্ণনা।\n৫'),
    createPage(6, 'বাংলার প্রকৃতি\n\nসমাপ্তি অনুচ্ছেদ।\n৬'),
  ];

  const { blob, validationReport } = await generateEpubBlob(
    { title: 'বাংলার প্রকৃতি', author: 'লেখক', publisher: 'প্রকাশক', genre: 'প্রকৃতি' },
    pages
  );

  assert.ok(validationReport?.isValid, 'EPUB package must validate cleanly after stripping running headers');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const tocXhtml = await zip.file('OEBPS/toc.xhtml')!.async('text');
  const page2Xhtml = await zip.file('OEBPS/page_2.xhtml')!.async('text');

  assert.ok(page2Xhtml.includes('id="toc-h-p3-1-'), 'Subheading 1.1 on p3 must have id="toc-h-p3-1-..." after running header removal');
  assert.ok(tocXhtml.includes('href="page_2.xhtml#toc-h-p3-1-'), 'TOC link must match id="toc-h-p3-1-..." in page_2.xhtml');

  console.log('  ✓ TOC Fix Test G Passed: Running headers stripped without shifting heading anchor counters.\n');
}

console.log('====================================================');
console.log('ALL 12 CORE TESTS + REGRESSION TESTS A-H + TOC FIX TESTS A-G PASSED!');
console.log('====================================================');

