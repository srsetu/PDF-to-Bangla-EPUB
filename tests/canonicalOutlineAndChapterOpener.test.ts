/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { PageItem, BookDetails, PdfTextBlock } from '../src/types';
import {
  generateEpubBlob,
  extractHeadingsFromMarkdown,
  markdownToXhtml,
  detectHeadingFromLine,
} from '../src/utils/epubGenerator';
import {
  extractAuthoritativeTocTree,
  buildCanonicalDocumentOutline,
} from '../src/utils/tocExtractor';
import { isIntentionalChapterStartPage } from '../src/utils/epubLayoutPipeline';

console.log('==================================================================');
console.log('RUNNING PHASE 8 CANONICAL OUTLINE, TOC & CHAPTER OPENER TESTS (1-9)');
console.log('==================================================================\n');

function createPage(
  pageNumber: number,
  markdown: string,
  options: {
    isTocPage?: boolean;
    layoutBlocks?: PdfTextBlock[];
    figures?: PageItem['figures'];
  } = {}
): PageItem {
  return {
    pageNumber,
    status: 'completed',
    thumbnailUrl: null,
    fullImageUrl: null,
    markdown,
    originalOcr: markdown,
    figures: options.figures || [],
    isTocPage: options.isTocPage || false,
    layoutBlocks: options.layoutBlocks,
  };
}

async function runTests() {
  // =========================================================================
  // SCENARIO 1: Explicitly Numbered Chapters (Single-line & Two-line Headers)
  // =========================================================================
  console.log('Scenario 1: Explicitly numbered chapters (single-line & two-line headers)...');
  {
    const pages: PageItem[] = [
      createPage(
        1,
        `# সূচিপত্র\nপ্রথম অধ্যায়: বাবরের ভারত অভিযান .......... ২\nদ্বিতীয় অধ্যায়: হুমায়ুনের রাজত্বকাল .......... ৩`,
        { isTocPage: true }
      ),
      createPage(
        2,
        `প্রথম অধ্যায়\nবাবরের ভারত অভিযান\n\n১৫২৬ সালে পানিপথের প্রথম যুদ্ধে বাবর ইব্রাহিম লোদিকে পরাজিত করেন।`
      ),
      createPage(
        3,
        `# দ্বিতীয় অধ্যায়: হুমায়ুনের রাজত্বকাল\n\nবাবরের মৃত্যুর পর হুমায়ুন দিল্লির সিংহাসনে আরোহণ করেন।`
      ),
    ];

    const headingsP2 = extractHeadingsFromMarkdown(pages[1].markdown, 2);
    assert.equal(headingsP2.length, 1, 'Two-line chapter header must be paired into a single heading');
    assert.equal(headingsP2[0].title, 'প্রথম অধ্যায়: বাবরের ভারত অভিযান');
    assert.equal(headingsP2[0].explicitNumberLabel, 'প্রথম অধ্যায়');
    assert.equal(headingsP2[0].semanticType, 'chapter');

    const bookDetails: BookDetails = {
      title: 'মুঘল সাম্রাজ্যের ইতিহাস',
      author: 'ড. আবদুল করিম',
      publisher: 'ঐতিহ্য প্রকাশনী',
      genre: 'ইতিহাস',
    };

    const res = await generateEpubBlob(bookDetails, pages);
    assert.ok(res.canonicalOutline, 'canonicalOutline must be returned');
    assert.equal(res.canonicalOutline!.entries.length, 2);
    assert.equal(res.canonicalOutline!.entries[0].explicitNumberLabel, 'প্রথম অধ্যায়');
    assert.equal(res.canonicalOutline!.entries[0].semanticType, 'chapter');
    assert.equal(res.validationReport?.isValid, true);
    assert.equal(res.validationReport?.warnings.length, 0, 'Zero broken anchor warnings');

    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer());
    const p2Xhtml = await zip.file('OEBPS/page_2.xhtml')!.async('text');
    assert.ok(
      p2Xhtml.includes('<header class="chapter-opener" epub:type="header">'),
      'Page 2 must contain a semantic chapter-opener header'
    );
    assert.ok(
      p2Xhtml.includes('<p class="chapter-number-label text-center">প্রথম অধ্যায়</p>'),
      'Two-line chapter opener must render explicit chapter number label'
    );
    assert.ok(
      p2Xhtml.includes('বাবরের ভারত অভিযান</h1>'),
      'Two-line chapter opener must render paired chapter title in h1'
    );
    assert.ok(
      p2Xhtml.includes('<hr class="chapter-opener-divider" />'),
      'Chapter opener must include decorative divider'
    );
    // Verify at most one chapter opener per chapter file
    assert.equal(
      (p2Xhtml.match(/class="chapter-opener"/g) || []).length,
      1,
      'Must emit at most one chapter-opener per chapter file'
    );

    console.log('  ✓ Scenario 1 Passed.\n');
  }

  // =========================================================================
  // SCENARIO 2: Unnumbered Chapter Titles (Typography / Font-Size Signal & No Invented Numbers)
  // =========================================================================
  console.log('Scenario 2: Unnumbered chapter titles (layoutBlocks typography & zero fabricated numbers)...');
  {
    const unnumberedChapterMarkdown = `কালান্তর\n\nনতুন যুগের সূচনা হলো বাংলার প্রান্তরে। মানুষ তার নিজের অধিকার সম্পর্কে সচেতন হয়ে উঠল।`;
    const layoutBlocks: PdfTextBlock[] = [
      { text: 'কালান্তর', fontSize: 22, top: 8, left: 35, width: 30, height: 5 },
      {
        text: 'নতুন যুগের সূচনা হলো বাংলার প্রান্তরে। মানুষ তার নিজের অধিকার সম্পর্কে সচেতন হয়ে উঠল।',
        fontSize: 12,
        top: 22,
        left: 10,
        width: 80,
        height: 15,
      },
    ];

    const pages: PageItem[] = [
      createPage(1, unnumberedChapterMarkdown, { layoutBlocks }),
      createPage(2, `# নবজাগরণ\n\nউনবিংশ শতাব্দীতে বাংলার সমাজ ও সাহিত্যে নবজাগরণ ঘটে।`),
    ];

    const headingsP1 = extractHeadingsFromMarkdown(pages[0].markdown, 1, false, layoutBlocks);
    assert.equal(headingsP1.length, 1, 'Large-font top-of-page unnumbered title must be detected via layoutBlocks');
    assert.equal(headingsP1[0].title, 'কালান্তর');
    assert.equal(headingsP1[0].explicitNumberLabel, undefined, 'Must NOT fabricate chapter number for unnumbered title');

    const res = await generateEpubBlob(
      { title: 'কালান্তর ও নবজাগরণ', author: 'রবীন্দ্রনাথ ঠাকুর', publisher: 'বিশ্বভারতী', genre: 'প্রবন্ধ' },
      pages
    );
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer());
    const p1Xhtml = await zip.file('OEBPS/page_1.xhtml')!.async('text');
    assert.ok(p1Xhtml.includes('<header class="chapter-opener" epub:type="header">'));
    assert.ok(!p1Xhtml.includes('chapter-number-label'), 'Unnumbered chapter must NOT have a fabricated chapter-number-label');
    assert.ok(p1Xhtml.includes('কালান্তর</h1>'));

    const navXhtml = await zip.file('OEBPS/nav.xhtml')!.async('text');
    assert.ok(navXhtml.includes('কালান্তর'));
    assert.ok(navXhtml.includes('নবজাগরণ'));

    console.log('  ✓ Scenario 2 Passed.\n');
  }

  // =========================================================================
  // SCENARIO 3: Bengali Alphabetical Subsections (ক., খ., (ক), (খ), ক))
  // =========================================================================
  console.log('Scenario 3: Bengali alphabetical subsections (ক., খ., (ক), (খ))...');
  {
    const pages: PageItem[] = [
      createPage(
        1,
        [
          '# সূচিপত্র',
          'প্রথম অধ্যায়: মুঘল প্রশাসন .......... ২',
          '  ক. কেন্দ্রীয় শাসনব্যবস্থা .......... ২',
          '  খ. প্রাদেশিক শাসনব্যবস্থা .......... ২',
          '  (গ) রাজস্ব ও ভূমি সংস্কার .......... ২',
        ].join('\n'),
        { isTocPage: true }
      ),
      createPage(
        2,
        [
          '# প্রথম অধ্যায়: মুঘল প্রশাসন',
          'মুঘল শাসনব্যবস্থা অত্যন্ত সুশৃঙ্খল ছিল।',
          '',
          'ক. কেন্দ্রীয় শাসনব্যবস্থা',
          'সম্রাট ছিলেন কেন্দ্রীয় শাসনের সর্বোচ্চ কর্তৃপক্ষে অধিষ্ঠিত এবং তাঁর অধীনে ওয়াজির ও মীর বখশি দায়িত্ব পালন করতেন।',
          '',
          'খ. প্রাদেশিক শাসনব্যবস্থা',
          'সাম্রাজ্যকে কয়েকটি সুবায় বিভক্ত করা হয়েছিল এবং প্রতিটি সুবার শাসনভার সুবাদারের ওপর ন্যস্ত ছিল।',
          '',
          '(গ) রাজস্ব ও ভূমি সংস্কার',
          'টোডরমলের বন্দোবস্ত ব্যবস্থার মাধ্যমে জমির জরিপ ও খাজনা নির্ধারণ করা হয়েছিল।',
        ].join('\n')
      ),
    ];

    const p2Headings = extractHeadingsFromMarkdown(pages[1].markdown, 2);
    assert.equal(p2Headings.length, 4, 'Should detect 1 chapter + 3 Bengali alphabetical subsections');
    assert.equal(p2Headings[1].level, 2);
    assert.equal(p2Headings[1].explicitNumberLabel, 'ক.');
    assert.equal(p2Headings[2].level, 2);
    assert.equal(p2Headings[2].explicitNumberLabel, 'খ.');
    assert.equal(p2Headings[3].level, 2);
    assert.equal(p2Headings[3].explicitNumberLabel, '(গ)');

    const res = await generateEpubBlob(
      { title: 'মুঘল প্রশাসন', author: 'ঐতিহাসিক', publisher: 'প্রকাশনী', genre: 'ইতিহাস' },
      pages
    );
    assert.equal(res.canonicalOutline!.entries.length, 1);
    assert.equal(res.canonicalOutline!.entries[0].children.length, 3, 'All 3 alphabetical subsections must be nested under Chapter 1');
    assert.equal(res.validationReport?.isValid, true);
    assert.equal(res.validationReport?.warnings.length, 0, 'All alphabetical subsection anchors must resolve with 0 warnings');

    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer());
    const p2Xhtml = await zip.file('OEBPS/page_2.xhtml')!.async('text');
    assert.equal(
      (p2Xhtml.match(/class="chapter-opener"/g) || []).length,
      1,
      'Subsection headings must NOT be rendered as full chapter openers'
    );
    assert.ok(p2Xhtml.includes('class="section-heading"'), 'Subsections must use section-heading class');

    console.log('  ✓ Scenario 3 Passed.\n');
  }

  // =========================================================================
  // SCENARIO 4: Multiple Subsection Levels (১.১, ১.১.১, ১.১.১.১ & h2/h3/h4)
  // =========================================================================
  console.log('Scenario 4: Multiple subsection levels (4-level hierarchy)...');
  {
    const pages: PageItem[] = [
      createPage(
        1,
        [
          '# সূচিপত্র',
          '১. প্রথম অধ্যায়: স্থাপত্যকলা .......... ২',
          '  ১.১ দুর্গ স্থাপত্য .......... ২',
          '    ১.১.১ আগ্রা দুর্গ .......... ২',
          '      ১.১.১.১ দেওয়ান-ই-আম .......... ২',
        ].join('\n'),
        { isTocPage: true }
      ),
      createPage(
        2,
        [
          '# ১. প্রথম অধ্যায়: স্থাপত্যকলা',
          'মুঘল আমলে স্থাপত্যকলার চরম বিকাশ ঘটে।',
          '',
          '১.১ দুর্গ স্থাপত্য',
          'প্রতিরক্ষা ও রাজকীয় বাসস্থানের জন্য দুর্গ নির্মিত হয়।',
          '',
          '১.১.১ আগ্রা দুর্গ',
          'লাল বেলেপাথরে নির্মিত আগ্রা দুর্গ আকবরের অন্যতম কীর্তি।',
          '',
          '#### ১.১.১.১ দেওয়ান-ই-আম',
          'সাধারণ প্রজাদের দরবার কক্ষ হিসেবে দেওয়ান-ই-আম ব্যবহৃত হতো।',
        ].join('\n')
      ),
    ];

    const res = await generateEpubBlob(
      { title: 'মুঘল স্থাপত্য', author: 'লেখক', publisher: 'প্রকাশনী', genre: 'স্থাপত্য' },
      pages
    );

    const l1 = res.canonicalOutline!.entries[0];
    assert.equal(l1.level, 1);
    assert.equal(l1.children.length, 1);
    const l2 = l1.children[0];
    assert.equal(l2.level, 2);
    assert.equal(l2.parentId, l1.id);
    assert.equal(l2.children.length, 1);
    const l3 = l2.children[0];
    assert.equal(l3.level, 3);
    assert.equal(l3.parentId, l2.id);
    assert.equal(l3.children.length, 1);
    const l4 = l3.children[0];
    assert.equal(l4.level, 4);
    assert.equal(l4.parentId, l3.id);

    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer());
    const navContent = await zip.file('OEBPS/nav.xhtml')!.async('text');
    const tocContent = await zip.file('OEBPS/toc.xhtml')!.async('text');
    const contentsContent = await zip.file('OEBPS/contents.xhtml')!.async('text');
    const ncxContent = await zip.file('OEBPS/toc.ncx')!.async('text');

    assert.ok(navContent.includes('level-3') && navContent.includes('level-4'), 'nav.xhtml must include nested levels 1..4');
    assert.ok(tocContent.includes('level-3') && tocContent.includes('level-4'), 'toc.xhtml must include nested levels 1..4');
    assert.equal(tocContent, contentsContent, 'contents.xhtml and toc.xhtml must be synchronized');
    assert.ok(ncxContent.includes('content="4"'), 'toc.ncx depth must be 4');
    assert.equal(res.validationReport?.warnings.length, 0, 'All 4 levels must link to valid anchors in page_2.xhtml');

    console.log('  ✓ Scenario 4 Passed.\n');
  }

  // =========================================================================
  // SCENARIO 5: Preface, Front Matter, and Back Matter
  // =========================================================================
  console.log('Scenario 5: Preface, front matter, and back matter semantic classification...');
  {
    const pages: PageItem[] = [
      createPage(1, `# ভূমিকা\n\nএই গ্রন্থটি রচনার পেছনে দীর্ঘ দশ বছরের গবেষণা রয়েছে।`),
      createPage(2, `# মুখবন্ধ\n\nদ্বিতীয় সংস্করণে নতুন কিছু তথ্য সংযোজিত হলো।`),
      createPage(3, `# প্রথম অধ্যায়: সূচনা\n\nমূল ইতিহাসের বিবরণ এখান থেকে শুরু।`),
      createPage(4, `# উপসংহার\n\nপরিশেষে বলা যায় ইতিহাসের শিক্ষা চিরন্তন।`),
      createPage(5, `# গ্রন্থপঞ্জি\n\n১. আকবরনামা — আবুল ফজল।`),
    ];

    const res = await generateEpubBlob(
      { title: 'ইতিহাস ও গবেষণা', author: 'গবেষক', publisher: 'প্রকাশনী', genre: 'ইতিহাস' },
      pages
    );
    const entries = res.canonicalOutline!.entries;
    assert.equal(entries.length, 5);
    assert.equal(entries[0].semanticType, 'frontmatter');
    assert.equal(entries[1].semanticType, 'frontmatter');
    assert.equal(entries[2].semanticType, 'chapter');
    assert.equal(entries[3].semanticType, 'backmatter');
    assert.equal(entries[4].semanticType, 'backmatter');

    console.log('  ✓ Scenario 5 Passed.\n');
  }

  // =========================================================================
  // SCENARIO 6: Book with No Reliable TOC in Source (Fallback Hierarchy Reconstruction)
  // =========================================================================
  console.log('Scenario 6: Book with no reliable TOC in source (hierarchical fallback)...');
  {
    const pages: PageItem[] = [
      createPage(
        1,
        [
          '# প্রথম অধ্যায়: বাংলার নদী',
          'বাংলাদেশ নদীমাতৃক দেশ।',
          '**একটি সাধারণ বোল্ড বাক্য যা কখনোই সূচিপত্রে যাবে না**',
          '## ১.১ পদ্মা নদী',
          'পদ্মা বাংলাদেশের অন্যতম প্রধান নদী।',
          '### ১.১.১ পদ্মার শাখা নদী',
          'মধুমতী ও ভৈরব পদ্মার অন্যতম শাখা নদী।',
        ].join('\n')
      ),
      createPage(
        2,
        [
          '# দ্বিতীয় অধ্যায়: বাংলার পাহাড়',
          'চট্টগ্রাম ও সিলেট অঞ্চলে পাহাড়ের বিস্তার রয়েছে।',
          '## ২.১ পার্বত্য চট্টগ্রাম',
          'কেওক্রাডং ও তাজিংডং এই অঞ্চলে অবস্থিত।',
        ].join('\n')
      ),
    ];

    const tocRes = extractAuthoritativeTocTree(pages);
    assert.equal(tocRes.isFallback, true, 'Must use fallback mode when no printed TOC exists');
    assert.equal(tocRes.tree.length, 2, 'Should have 2 top-level chapters');
    assert.equal(tocRes.tree[0].children.length, 1, 'Chapter 1 should have 1 section child (১.১)');
    assert.equal(tocRes.tree[0].children[0].children.length, 1, 'Section ১.১ should have 1 subsection child (১.১.১)');
    assert.ok(
      !JSON.stringify(tocRes.tree).includes('সাধারণ বোল্ড বাক্য'),
      'Unnumbered bold body sentences must NOT leak into fallback TOC'
    );

    console.log('  ✓ Scenario 6 Passed.\n');
  }

  // =========================================================================
  // SCENARIO 7: Headings Near PDF Page Boundaries & Cross-Page Continuity
  // =========================================================================
  console.log('Scenario 7: Headings near PDF page boundaries & cross-page paragraph continuity...');
  {
    const pages: PageItem[] = [
      createPage(
        1,
        `# প্রথম অধ্যায়: মুঘল দরবার\n\nএটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য`
      ),
      createPage(
        2,
        `উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে।\n\n## ১.১ দরবারের রীতিনীতি\n\nদরবারে প্রবেশের সময় কুর্নিশ করার নিয়ম ছিল।`
      ),
      createPage(
        3,
        `# দ্বিতীয় অধ্যায়: সম্রাটের গ্রন্থাগার\n\nমুঘল সম্রাটগণ বই ও পান্ডুলিপি সংগ্রহে অত্যন্ত আগ্রহী ছিলেন।`
      ),
    ];

    const res = await generateEpubBlob(
      { title: 'মুঘল দরবার', author: 'লেখক', publisher: 'প্রকাশনী', genre: 'ইতিহাস' },
      pages,
      null,
      'noto',
      undefined,
      undefined,
      { smartSpacing: true }
    );

    assert.equal(res.layoutReport?.crossPageParagraphsMerged, 1, 'Cross-page paragraph must still merge across page 1 -> 2');
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer());
    const p1Xhtml = await zip.file('OEBPS/page_1.xhtml')!.async('text');
    assert.ok(
      p1Xhtml.includes('অনেক রহস্য উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে।'),
      'Continuous sentence across page boundary must be joined with a single space'
    );
    assert.ok(
      p1Xhtml.includes('১.১ দরবারের রীতিনীতি'),
      'Subsection heading on consolidated continuation page 2 must be preserved in page_1.xhtml'
    );
    assert.ok(
      zip.file('OEBPS/page_3.xhtml'),
      'Page 3 starting a new Chapter 2 must start a separate chapter XHTML file'
    );
    assert.equal(res.validationReport?.warnings.length, 0, 'Consolidated subsection anchor must resolve in page_1.xhtml');

    console.log('  ✓ Scenario 7 Passed.\n');
  }

  // =========================================================================
  // SCENARIO 8: Image-Only or Illustrated Chapter-Opening Pages
  // =========================================================================
  console.log('Scenario 8: Illustrated / image-first chapter-opening pages...');
  {
    const sampleBase64Png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const pages: PageItem[] = [
      createPage(1, `# ভূমিকা\n\nগ্রন্থের ভূমিকা ও সংক্ষিপ্ত বিবরণ।`),
      createPage(
        2,
        `[IMAGE_FIGURE: {"align": "center"}]\nচিত্র ১: পানিপথের যুদ্ধক্ষেত্র\n\n# প্রথম অধ্যায়: পানিপথের প্রান্তর\n\nযুদ্ধক্ষেত্রের বিস্তারিত বিবরণ।`,
        {
          figures: [
            {
              id: 'fig-1',
              imageUrl: sampleBase64Png,
              caption: 'চিত্র ১: পানিপথের যুদ্ধক্ষেত্র',
              align: 'center',
            },
          ],
        }
      ),
    ];

    assert.equal(
      isIntentionalChapterStartPage(pages[1], 1, new Set(), new Set()),
      true,
      'Page starting with an illustration followed by a chapter heading must be recognized as an intentional chapter start'
    );

    const res = await generateEpubBlob(
      { title: 'সচিত্র ইতিহাস', author: 'লেখক', publisher: 'প্রকাশনী', genre: 'ইতিহাস' },
      pages
    );
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer());
    const p2File = zip.file('OEBPS/page_2.xhtml');
    assert.ok(p2File, 'Illustrated chapter opening page 2 must not be merged into page 1');
    const p2Xhtml = await p2File!.async('text');
    assert.ok(p2Xhtml.includes('<figure'), 'Illustration figure must be preserved');
    assert.ok(p2Xhtml.includes('চিত্র ১: পানিপথের যুদ্ধক্ষেত্র'), 'Legitimate figure caption must be preserved');
    assert.ok(p2Xhtml.includes('<header class="chapter-opener" epub:type="header">'), 'Chapter opener must be generated after the illustration');

    console.log('  ✓ Scenario 8 Passed.\n');
  }

  // =========================================================================
  // SCENARIO 9: Ambiguous or Corrupted OCR Headings (Rejected as Headings, Preserved as Text)
  // =========================================================================
  console.log('Scenario 9: Ambiguous/corrupted OCR headings preserved as text and excluded from TOC...');
  {
    const pages: PageItem[] = [
      createPage(
        1,
        [
          '# প্রথম অধ্যায়: প্রাচীন লিপি',
          'প্রাচীন শিলালিপির পাঠোদ্ধার অত্যন্ত জটিল কাজ।',
          '',
          '# @#$% ^&* ~|',
          '**12345 67890**',
          '',
          'শিলালিপির এই অংশটুকু অস্পষ্ট হলেও মূল অর্থ বোঝা যায়।',
        ].join('\n')
      ),
    ];

    const detectedCorrupted1 = detectHeadingFromLine('# @#$% ^&* ~|', 1, 2, false);
    const detectedCorrupted2 = detectHeadingFromLine('**12345 67890**', 1, 3, false);
    assert.equal(detectedCorrupted1, null, 'Symbol-heavy OCR garbage with # must NOT be detected as a heading');
    assert.equal(detectedCorrupted2, null, 'Digits-only line must NOT be detected as a heading');

    const res = await generateEpubBlob(
      { title: 'প্রাচীন লিপি', author: 'গবেষক', publisher: 'প্রকাশনী', genre: 'গবেষণা' },
      pages
    );

    assert.equal(res.canonicalOutline!.entries.length, 1, 'Only the genuine chapter heading may appear in the TOC');
    assert.equal(res.canonicalOutline!.entries[0].title, 'প্রথম অধ্যায়: প্রাচীন লিপি');
    assert.ok(
      res.canonicalOutline!.uncertainHeadings.length >= 1,
      'Corrupted heading attempts must be recorded in canonicalOutline.uncertainHeadings diagnostics'
    );

    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer());
    const p1Xhtml = await zip.file('OEBPS/page_1.xhtml')!.async('text');
    assert.equal(
      (p1Xhtml.match(/class="chapter-opener"/g) || []).length,
      1,
      'Ambiguous/corrupted OCR lines must NOT create extra chapter openers'
    );
    assert.ok(
      p1Xhtml.includes('12345 67890'),
      'Ambiguous OCR text must still be preserved in the document body without data loss'
    );

    console.log('  ✓ Scenario 9 Passed.\n');
  }

  console.log('==================================================================');
  console.log('ALL 9 PHASE 8 SCENARIOS PASSED SUCCESSFULLY!');
  console.log('==================================================================');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
