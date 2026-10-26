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
} from '../src/utils/tocExtractor';
import { generateEpubBlob, isTableOfContentsText } from '../src/utils/epubGenerator';
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

console.log('====================================================');
console.log('ALL 12 TEST CASES EXECUTED SUCCESSFULLY!');
console.log('====================================================');
