import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  generateEpubBlob,
  markdownToXhtml,
  evaluateParagraphContinuation,
  classifyCrossPageContinuity,
  reconstructMultiColumnFromGeometry,
  reconstructMultiColumnMarkdown,
  reconstructDocumentLayoutForEpub,
  normalizeEpubLayoutXhtml,
  validateEpubXhtmlLayout,
} from '../src/utils/epubGenerator';
import { validateEpubPackage } from '../src/utils/xhtmlValidator';
import { BookDetails, PageItem, PdfTextBlock, EpubTocItem } from '../src/types';

const DEFAULT_BOOK: BookDetails = {
  title: 'রবীন্দ্র রচনাবলী নির্বাচিত প্রবন্ধ',
  author: 'রবীন্দ্রনাথ ঠাকুর',
  publisher: 'বিশ্বভারতী গ্রন্থনবিভাগ',
  language: 'bn',
  description: 'ইন্টেলিজেন্ট ইপাব লেআউট রিকনস্ট্রাকশন টেস্ট',
};

function makePage(pageNumber: number, markdown: string, extra?: Partial<PageItem>): PageItem {
  return {
    pageNumber,
    status: 'completed',
    thumbnailUrl: '',
    fullImageUrl: '',
    markdown,
    originalOcr: markdown,
    figures: [],
    isTocPage: false,
    hasImages: false,
    ...extra,
  };
}

async function runTests() {
  console.log('Running Intelligent EPUB Layout Reconstruction & Gap Removal Tests...\n');

  // ============================================================================
  // TEST 1: Single-Column PDF Pages & HTML/CSS Gap Normalization
  // ============================================================================
  console.log('Test 1: Single-column PDF pages & HTML/CSS gap normalization...');
  {
    const rawNoisyMarkdown = [
      '# প্রথম অধ্যায়',
      '',
      '<p></p>',
      '<div style="height: 450px; margin-top: 220px; position: absolute; top: 100px;">   </div>',
      '<p style="margin-bottom: 180px; padding-top: 120px; page-break-after: always;">বাংলার সাহিত্য ও সংস্কৃতির ধারা বহু শতাব্দী ধরে প্রবাহিত হয়ে চলেছে।</p>',
      '<br/><br/><br/><br/>',
      '<span>   </span>',
      'এই ধারায় অসংখ্য কবি ও সাহিত্যিকের অবদান রয়েছে।',
    ].join('\n');

    const xhtml = markdownToXhtml(rawNoisyMarkdown, [], { pageNumber: 1 });

    // Empty tags, artificial page-breaks, fixed heights, and excessive margins must be removed
    assert.ok(!xhtml.includes('<p></p>'), 'Empty <p></p> tags must be removed');
    assert.ok(!xhtml.includes('height: 450px'), 'Fixed pixel height spacer must be removed');
    assert.ok(!xhtml.includes('margin-bottom: 180px'), 'Excessive margin-bottom must be stripped');
    assert.ok(!xhtml.includes('page-break-after: always'), 'Artificial page-break style must be stripped');
    assert.ok(!/(?:<br\s*\/?>\s*){2,}/i.test(xhtml), 'Repeated <br/> tags must be collapsed');

    // Legitimate prose content must remain intact
    assert.ok(xhtml.includes('বাংলার সাহিত্য ও সংস্কৃতির ধারা বহু শতাব্দী ধরে প্রবাহিত হয়ে চলেছে।'));
    assert.ok(xhtml.includes('এই ধারায় অসংখ্য কবি ও সাহিত্যিকের অবদান রয়েছে।'));

    const layoutCheck = validateEpubXhtmlLayout(xhtml);
    assert.equal(layoutCheck.isValid, true, 'Normalized XHTML should pass layout validation with zero warnings');
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 2: Two-Column & Three-Column PDF Pages (Geometry & Side-by-Side Text)
  // ============================================================================
  console.log('Test 2: Multi-column reading order reconstruction (2-column & 3-column)...');
  {
    // 2A: 2-Column PDF Geometry blocks with a full-width spanning title at top and full-width footnote at bottom
    const geometryBlocks: PdfTextBlock[] = [
      // Spanning title across top
      { text: '# সাময়িকপত্র ও সাহিত্য', x: 80, y: 40, width: 440, height: 28, fontSize: 20 },
      // Interleaved Y coordinates between Column 1 (x=50) and Column 2 (x=330) on a 600px wide page
      { text: 'বাম কলামের প্রথম অনুচ্ছেদের প্রথম লাইন এখানে শুরু হলো।', x: 50, y: 100, width: 230, height: 16 },
      { text: 'ডান কলামের প্রথম অনুচ্ছেদের লাইন যা বাম কলামের পরে পড়া উচিত।', x: 330, y: 102, width: 230, height: 16 },
      { text: 'বাম কলামের দ্বিতীয় লাইন যা প্রথম লাইনের ঠিক নিচে রয়েছে।', x: 50, y: 124, width: 230, height: 16 },
      { text: 'ডান কলামের দ্বিতীয় লাইন যা ডান কলামের নিচে রয়েছে।', x: 330, y: 126, width: 230, height: 16 },
      { text: 'বাম কলামের তৃতীয় ও শেষ লাইন এখানে সমাপ্ত হলো।', x: 50, y: 148, width: 230, height: 16 },
      { text: 'ডান কলামের তৃতীয় ও শেষ লাইন এখানে সমাপ্ত হলো।', x: 330, y: 150, width: 230, height: 16 },
      // Spanning footnote across bottom
      { text: '১. বঙ্গদর্শন পত্রিকায় প্রথম প্রকাশিত, ১২৭৯ বঙ্গাব্দ।', x: 50, y: 720, width: 480, height: 14, fontSize: 10 },
    ];

    const geomResult = reconstructMultiColumnFromGeometry(geometryBlocks, 600, 800);
    assert.equal(geomResult.columnCount, 2, 'Should detect 2-column layout from PDF geometry');
    assert.equal(geomResult.isMultiColumn, true, 'Should mark multi-column geometry as isMultiColumn');

    const titleIdx = geomResult.reorderedText.indexOf('# সাময়িকপত্র ও সাহিত্য');
    const col1Line1Idx = geomResult.reorderedText.indexOf('বাম কলামের প্রথম অনুচ্ছেদের প্রথম লাইন');
    const col1Line3Idx = geomResult.reorderedText.indexOf('বাম কলামের তৃতীয় ও শেষ লাইন');
    const col2Line1Idx = geomResult.reorderedText.indexOf('ডান কলামের প্রথম অনুচ্ছেদের লাইন');
    const col2Line3Idx = geomResult.reorderedText.indexOf('ডান কলামের তৃতীয় ও শেষ লাইন');
    const footnoteIdx = geomResult.reorderedText.indexOf('১. বঙ্গদর্শন পত্রিকায় প্রথম প্রকাশিত');

    assert.ok(titleIdx < col1Line1Idx, 'Spanning title must appear before Column 1');
    assert.ok(col1Line1Idx < col1Line3Idx, 'Column 1 lines must be ordered top-to-bottom');
    assert.ok(col1Line3Idx < col2Line1Idx, 'Entire Column 1 must precede Column 2');
    assert.ok(col2Line1Idx < col2Line3Idx, 'Column 2 lines must be ordered top-to-bottom');
    assert.ok(col2Line3Idx < footnoteIdx, 'Spanning bottom footnote must appear after Column 2');

    // 2B: Side-by-side text gutter columns in OCR Markdown
    const gutterMarkdown = [
      '# দ্বিকলাম প্রবন্ধ',
      '',
      'বাম কলামের প্রথম বাক্য।          ডান কলামের প্রথম বাক্য।',
      'বাম কলামের দ্বিতীয় বাক্য।         ডান কলামের দ্বিতীয় বাক্য।',
      'বাম কলামের তৃতীয় বাক্য।         ডান কলামের তৃতীয় বাক্য।',
    ].join('\n');

    const gutterRes = reconstructMultiColumnMarkdown(gutterMarkdown);
    assert.equal(gutterRes.isMultiColumn, true, 'Should detect and linearize side-by-side gutter columns');
    assert.ok(
      gutterRes.reorderedText.indexOf('বাম কলামের তৃতীয় বাক্য।') <
        gutterRes.reorderedText.indexOf('ডান কলামের প্রথম বাক্য।'),
      'Left column sentences must all appear before right column sentences'
    );
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 3: Paragraphs Continuing Across Pages & Confidence Scoring
  // ============================================================================
  console.log('Test 3: Cross-page paragraph continuation & confidence scoring...');
  {
    // High confidence: Page 1 ends mid-sentence with a conjunction/comma, Page 2 continues in prose
    const highConf = evaluateParagraphContinuation(
      'তখনকার দিনে যাতায়াতের পথ অত্যন্ত দুর্গম ছিল এবং',
      'নদীপথে নৌকা ছাড়া অন্য কোনো বাহন সহজে পাওয়া যেত না।'
    );
    assert.equal(highConf.shouldMerge, true, 'Mid-sentence conjunction across page boundary must merge');
    assert.equal(highConf.confidence, 'high', 'Should have high continuation confidence');

    // High confidence: Hyphenated split word across page boundary
    const hyphenConf = evaluateParagraphContinuation(
      'রবীন্দ্রনাথের সাহিত্যিক প্রতিভার বহুমুখী বিকাশ দেখা যায় তাঁর রচি-',
      'ত ছোটগল্প, উপন্যাস এবং প্রবন্ধের প্রতিটি ছত্রে।'
    );
    assert.equal(hyphenConf.shouldMerge, true, 'Hyphenated word across page boundary must merge');
    assert.ok(
      hyphenConf.mergedText?.includes('রচিত ছোটগল্প'),
      'Hyphenated Bengali word should be rejoined into "রচিত"'
    );

    // Non-merge guard: Page 1 ends with terminal punctuation (।) and Page 2 starts a new chapter heading
    const headingGuard = evaluateParagraphContinuation(
      'এইভাবে প্রথম পর্বের সমাপ্তি ঘটল।',
      '# দ্বিতীয় অধ্যায়'
    );
    assert.equal(headingGuard.shouldMerge, false, 'Must NEVER merge prose into a chapter heading');
    assert.equal(headingGuard.confidence, 'none');

    // Non-merge guard: Terminal punctuation followed by an indented new paragraph
    const newParaGuard = evaluateParagraphContinuation(
      'সন্ধ্যার অন্ধকারে চারপাশ নিস্তব্ধ হয়ে এল।',
      '<p class="indent-1">পরদিন ভোরে আবার নতুন করে যাত্রা শুরু হলো।</p>'
    );
    assert.equal(newParaGuard.shouldMerge, false, 'Must NOT merge a completed paragraph into an indented new paragraph');
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 4: Chapters Beginning on a New Page vs Continuation Pages
  // ============================================================================
  console.log('Test 4: Chapters beginning on a new page vs continuous pages...');
  {
    // Page 1: Cover, Page 2: Chapter 1 start (ends mid-sentence), Page 3: Continuation of Chapter 1, Page 4: Chapter 2 start
    const pages: PageItem[] = [
      makePage(1, '# রবীন্দ্র রচনাবলী\n\nরবীন্দ্রনাথ ঠাকুর'),
      makePage(
        2,
        '# প্রথম অধ্যায়: সূচনা\n\nরবীন্দ্রনাথের বাল্যকাল কেটেছে জোড়াসাঁকোর ঠাকুরবাড়ির সাহিত্যিক পরিবেশে এবং\n\n১২'
      ),
      makePage(
        3,
        'রবীন্দ্র রচনাবলী নির্বাচিত প্রবন্ধ\n\nসেই পরিবেশ তাঁর মনে গভীর কাব্যবোধ ও প্রকৃতিপ্রেম জাগিয়ে তুলেছিল।\n\nপরবর্তী অনুচ্ছেদে তাঁর কৈশোরের কথা বর্ণিত হয়েছে।\n\n১৩'
      ),
      makePage(
        4,
        '# দ্বিতীয় অধ্যায়: সাহিত্য সাধনা\n\nকৈশোর পেরিয়ে যৌবনে পদার্পণ করেই তিনি একের পর এক অমর কাব্য রচনা করেন।'
      ),
    ];

    const reconstructed = reconstructDocumentLayoutForEpub(pages, { bookDetails: DEFAULT_BOOK });

    // Page 2 and Page 3 should be consolidated into a single chapter section (page_2.xhtml),
    // while Page 4 starts a new chapter section (page_4.xhtml)!
    assert.equal(
      reconstructed.consolidatedGroups.length,
      3,
      'Cover (p1), Chapter 1 (p2+p3 consolidated), and Chapter 2 (p4) should produce 3 spine sections'
    );
    assert.deepEqual(
      reconstructed.consolidatedGroups[1].sourcePageNumbers,
      [2, 3],
      'Chapter 1 section must consolidate Page 2 and Page 3'
    );
    assert.deepEqual(
      reconstructed.consolidatedGroups[2].sourcePageNumbers,
      [4],
      'Chapter 2 must start on its own new EPUB section'
    );

    // Check that the split sentence across Page 2 and Page 3 was seamlessly merged into a single paragraph
    assert.ok(
      reconstructed.consolidatedGroups[1].sectionPage.markdown.includes(
        'রবীন্দ্রনাথের বাল্যকাল কেটেছে জোড়াসাঁকোর ঠাকুরবাড়ির সাহিত্যিক পরিবেশে এবং সেই পরিবেশ তাঁর মনে গভীর কাব্যবোধ ও প্রকৃতিপ্রেম জাগিয়ে তুলেছিল।'
      ),
      'Cross-page split sentence must be merged into a single continuous paragraph without page numbers or running headers'
    );
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 5: Pages Containing Images and Captions
  // ============================================================================
  console.log('Test 5: Pages containing images and captions...');
  {
    const pageWithFigure = [
      '# চিত্রকলা ও নন্দনতত্ত্ব',
      '',
      'নিচের চিত্রটি শান্তিনিকেতনের কলাভবনের একটি ঐতিহাসিক মুহূর্ত নির্দেশ করে।',
      '',
      '![কলাভবন](images/fig_p2_1.png)',
      '*চিত্র ১: শান্তিনিকেতনের কলাভবন প্রাঙ্গণ*',
      '',
      'চিত্রের নিচের এই অনুচ্ছেদটি কখনোই ক্যাপশনের সাথে একীভূত হবে না।',
    ].join('\n');

    const xhtml = markdownToXhtml(pageWithFigure, [], { pageNumber: 2 });
    assert.ok(xhtml.includes('<img src="images/fig_p2_1.png"'), 'Image element must be preserved');
    assert.ok(
      xhtml.includes('<figcaption class="figure-caption">চিত্র ১: শান্তিনিকেতনের কলাভবন প্রাঙ্গণ</figcaption>'),
      'Figcaption must be preserved and associated with its image container'
    );
    assert.ok(
      xhtml.includes('<p>চিত্রের নিচের এই অনুচ্ছেদটি কখনোই ক্যাপশনের সাথে একীভূত হবে না।</p>'),
      'Following prose paragraph must remain separate from figure caption'
    );
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 6: Pages Containing Tables and Footnotes
  // ============================================================================
  console.log('Test 6: Pages containing tables and footnotes...');
  {
    const tableAndFootnoteMd = [
      '# গ্রন্থপঞ্জি ও টীকা',
      '',
      '| গ্রন্থের নাম | প্রকাশকাল | ধরন |',
      '| --- | --- | --- |',
      '| গীতাঞ্জলি | ১৯১০ | কাব্যগ্রন্থ |',
      '| গোরা | ১৯১০ | উপন্যাস |',
      '| রক্তকরবী | ১৯২৬ | নাটক |',
      '',
      'উপরের সারণিতে রবীন্দ্রনাথের তিনটি প্রধান গ্রন্থের তথ্য দেওয়া হলো।',
      '',
      '১. গীতাঞ্জলি কাব্যের ইংরেজি অনুবাদের জন্য ১৯১৩ সালে নোবেল পুরস্কার প্রদান করা হয়।',
    ].join('\n');

    const xhtml = markdownToXhtml(tableAndFootnoteMd, [], { pageNumber: 3 });
    assert.ok(
      xhtml.includes('<table class="epub-table"><tbody>'),
      'Markdown table rows must be wrapped in a valid <table class="epub-table"><tbody> element'
    );
    assert.ok(xhtml.includes('<td>গীতাঞ্জলি</td><td>১৯১০</td><td>কাব্যগ্রন্থ</td>'), 'Table cells must remain intact');

    // Verify footnote is never merged into preceding prose
    const footnoteEval = evaluateParagraphContinuation(
      'উপরের সারণিতে রবীন্দ্রনাথের তিনটি প্রধান গ্রন্থের তথ্য দেওয়া হলো',
      '১. গীতাঞ্জলি কাব্যের ইংরেজি অনুবাদের জন্য ১৯১৩ সালে নোবেল পুরস্কার প্রদান করা হয়।'
    );
    assert.equal(footnoteEval.shouldMerge, false, 'Footnotes must never be merged into preceding prose');
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 7: Pages Containing Complex Bengali Typography & Conjuncts
  // ============================================================================
  console.log('Test 7: Complex Bengali typography (যুক্তাক্ষর, কার-চিহ্ন, चंद्रবিন্দু, দাঁড়ি)...');
  {
    const bengaliPages: PageItem[] = [
      makePage(1, '# রবীন্দ্র প্রবন্ধ সংগ্রহ'),
      makePage(
        2,
        '# বঙ্গভাষা ও সাহিত্য\n\nসংস্কৃত সাহিত্যের সৌন্দর্য ও ঐশ্বর্য অপরিসীম হলেও বাংলা ভাষার নিজস্ব মাধুর্য, ধ্বনিবৈচিত্র্য এবং যুক্তাক্ষরের (ক্ষ, জ্ঞ, ষ্ণ, ণ্ড, হ্ণ, ঙ্ক, ঙ্গ, ঙ্ঘ, শ্র, দ্ধ, ত্ত্ব) সূক্ষ্ম ব্যঞ্জনা আমাদের চিত্তকে বিশেষভাবে স্পর্শ করে এবং'
      ),
      makePage(
        3,
        'সাধারণ মানুষের মুখের ভাষার সাথে সাহিত্যিক ভাষার মেলবন্ধন ঘটিয়েই আধুনিক বাংলা গদ্যের পূর্ণাঙ্গ রূপটি গড়ে উঠেছে।'
      ),
    ];

    const epubRes = await generateEpubBlob(DEFAULT_BOOK, bengaliPages, null, 'noto');
    assert.equal(epubRes.validationReport?.isValid, true, 'Complex Bengali EPUB must pass full package validation');
    assert.ok(epubRes.layoutReport, 'EpubGenerationResult must include layoutReport metrics');
    assert.ok(
      epubRes.layoutReport!.crossPageParagraphsMerged >= 1,
      'Should merge the cross-page Bengali paragraph'
    );

    const zip = await JSZip.loadAsync(await epubRes.blob.arrayBuffer());
    const chap2Xhtml = await zip.file('OEBPS/page_2.xhtml')!.async('string');

    // Verify all complex Bengali conjuncts, chandrabindu, visarga, anusvara, and danda are 100% preserved
    for (const conjunct of ['ঐশ্বর্য', 'ধ্বনিবৈচিত্র্য', 'যুক্তাক্ষরের', 'ক্ষ', 'জ্ঞ', 'ষ্ণ', 'ণ্ড', 'হ্ণ', 'ঙ্ক', 'ঙ্গ', 'ঙ্ঘ', 'পূর্ণাঙ্গ', 'গড়ে উঠেছে।']) {
      assert.ok(chap2Xhtml.includes(conjunct), `Complex Bengali token "${conjunct}" must be losslessly preserved`);
    }
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 8: Legitimate Large Section Spacing & Before-vs-After Comparison
  // ============================================================================
  console.log('Test 8: Legitimate section breaks preserved + Before vs After EPUB comparison...');
  {
    const pagesWithSectionBreakAndSubheading: PageItem[] = [
      makePage(1, '# সূচিপত্র\n\n১. প্রথম অধ্যায় — ২\n১.১ উপবিভাগ ক — ৩\n২. দ্বিতীয় অধ্যায় — ৪', {
        isTocPage: true,
      }),
      makePage(
        2,
        '# প্রথম অধ্যায়\n\nপ্রথম দৃশ্যের ঘটনাপ্রবাহ অত্যন্ত দ্রুতগতিতে এগিয়ে চলে।\n\n* * *\n\nএকই অধ্যায়ের দ্বিতীয় দৃশ্যের সূচনা হয় নদীর তীরে এবং'
      ),
      makePage(
        3,
        'সেখানে মাঝিদের গানের সুরে চারপাশ মুখরিত হয়ে ওঠে।\n\n## উপবিভাগ ক\n\nউপবিভাগের বিস্তারিত আলোচনা এখানে সংযোজিত হয়েছে।'
      ),
      makePage(
        4,
        '# দ্বিতীয় অধ্যায়\n\nদ্বিতীয় অধ্যায়ের নতুন অনুচ্ছেদ।'
      ),
    ];

    const epubRes = await generateEpubBlob(DEFAULT_BOOK, pagesWithSectionBreakAndSubheading, null, 'noto');
    assert.equal(
      epubRes.validationReport?.isValid,
      true,
      `EPUB with consolidated pages and subheadings must pass validation without broken TOC anchors: ${JSON.stringify(
        epubRes.validationReport?.errors
      )}`
    );

    const zip = await JSZip.loadAsync(await epubRes.blob.arrayBuffer());
    const page2Xhtml = await zip.file('OEBPS/page_2.xhtml')!.async('string');
    const navXhtml = await zip.file('OEBPS/nav.xhtml')!.async('string');

    // 1. Intentional ornamental section break (* * *) must be preserved as <p class="section-divider text-center">* * *</p>
    assert.ok(
      page2Xhtml.includes('section-divider'),
      'Intentional ornamental section break (* * *) must be preserved'
    );

    // 2. Cross-page sentence between Page 2 and Page 3 must be merged
    assert.ok(
      page2Xhtml.includes('একই অধ্যায়ের দ্বিতীয় দৃশ্যের সূচনা হয় নদীর তীরে এবং সেখানে মাঝিদের গানের সুরে চারপাশ মুখরিত হয়ে ওঠে।'),
      'Cross-page prose between Page 2 and Page 3 must be merged seamlessly'
    );

    // 3. Subheading from Page 3 ("উপবিভাগ ক") is now inside page_2.xhtml and its TOC link must resolve to page_2.xhtml#toc-h-p3-...
    assert.ok(
      navXhtml.includes('page_2.xhtml#toc-h-p3-'),
      'TOC link for subheading on consolidated Page 3 must automatically remap to page_2.xhtml#toc-h-p3-...'
    );
    assert.ok(
      page2Xhtml.includes('id="toc-h-p3-'),
      'Consolidated page_2.xhtml must preserve the exact p3 heading anchor ID so TOC navigation works flawlessly'
    );

    console.log('  Layout Cleanup Report Summary:', epubRes.layoutReport);
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 9: Smart Spacing 6-Way Boundary Classification & Uncertain Non-Guessing
  // ============================================================================
  console.log('Test 9: Smart Spacing 6-way boundary classification (SAME_PARAGRAPH, NEW_PARAGRAPH, NEW_HEADING, NEW_CHAPTER, STRUCTURED_CONTENT, UNCERTAIN)...');
  {
    const { classifyCrossPageContinuity, isPoetryOrVerseBlock } = await import('../src/utils/epubGenerator');

    // 1. SAME_PARAGRAPH
    const samePara = classifyCrossPageContinuity(
      'গ্রামীণ বাংলার মানুষের জীবনযাত্রা নদীর প্রবাহের সাথে ওতপ্রোতভাবে জড়িত এবং',
      'বর্ষাকালে সেই নদীর দুকূল ছাপিয়ে পলিমাটি এসে ফসলের মাঠকে উর্বর করে তোলে।'
    );
    assert.equal(samePara.classification, 'SAME_PARAGRAPH');
    assert.equal(samePara.shouldMerge, true);

    // 2. NEW_PARAGRAPH (ends with danda ।, next starts a new complete paragraph)
    const newPara = classifyCrossPageContinuity(
      'সন্ধ্যার অন্ধকারে চারপাশ নিস্তব্ধ হয়ে এল।',
      'পরদিন ভোরে আবার নতুন করে যাত্রা শুরু হলো।'
    );
    assert.equal(newPara.classification, 'NEW_PARAGRAPH');
    assert.equal(newPara.shouldMerge, false);

    // 3. NEW_CHAPTER
    const newChap = classifyCrossPageContinuity(
      'এখানেই প্রথম পর্বের সমাপ্তি ঘটল।',
      '# দ্বিতীয় অধ্যায়: নতুন দিগন্ত'
    );
    assert.equal(newChap.classification, 'NEW_CHAPTER');
    assert.equal(newChap.shouldMerge, false);

    // 4. NEW_HEADING
    const newHead = classifyCrossPageContinuity(
      'এ বিষয়ে বিস্তারিত আলোচনা নিচে করা হলো।',
      '## প্রাসঙ্গিক ঐতিহাসিক প্রেক্ষাপট'
    );
    assert.equal(newHead.classification, 'NEW_HEADING');
    assert.equal(newHead.shouldMerge, false);

    // 5. STRUCTURED_CONTENT (Lists & Poetry)
    const poemStanza = 'বাংলার মাটি বাংলার জল\nবাংলার বায়ু বাংলার ফল\nপুণ্য হউক পুণ্য হউক\nপুণ্য হউক হে ভগবান ॥';
    assert.equal(isPoetryOrVerseBlock(poemStanza), true, 'Bengali stanza with short verse lines / double danda must be recognized as poetry');

    const structuredPoetry = classifyCrossPageContinuity(
      'রবীন্দ্রনাথ স্বদেশী যুগে রচনা করেছিলেন:',
      poemStanza
    );
    assert.equal(structuredPoetry.classification, 'STRUCTURED_CONTENT');
    assert.equal(structuredPoetry.shouldMerge, false, 'Poetry stanza must NEVER be merged into prose');

    // Verify poetry line breaks inside a page are preserved in reconstructed layout
    const poetryPage = makePage(1, `# কবিতা সংগ্রহ\n\n${poemStanza}`);
    const poetryRecon = reconstructDocumentLayoutForEpub([poetryPage], {
      bookDetails: DEFAULT_BOOK,
      smartSpacing: true,
    });
    assert.ok(
      poetryRecon.consolidatedGroups[0].sectionPage.markdown.includes(
        'বাংলার মাটি বাংলার জল\nবাংলার বায়ু বাংলার ফল'
      ),
      'Poetry single-newline line breaks must remain intact and never flatten into prose'
    );

    // 6. UNCERTAIN (Dangling halant or ambiguous fragment where merging would require guessing)
    const danglingHalant = classifyCrossPageContinuity(
      'তৎকালীন সমাজের নানাবিধ সংস্কা্',
      'রের মাধ্যমে নতুন যুগের সূচনা হয়।'
    );
    assert.equal(
      danglingHalant.classification,
      'UNCERTAIN',
      'Dangling halant at page end must be classified as UNCERTAIN to prevent corrupt conjunct guessing'
    );
    assert.equal(danglingHalant.shouldMerge, false, 'UNCERTAIN boundary must NOT merge');

    const ambiguousShort = classifyCrossPageContinuity(
      'ক-',
      'খ'
    );
    assert.equal(ambiguousShort.classification, 'UNCERTAIN');
    assert.equal(ambiguousShort.shouldMerge, false);
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 10: Repeat Conversion Idempotency & Original OCR Preservation
  // ============================================================================
  console.log('Test 10: Repeat conversion idempotency & originalOcr preservation...');
  {
    const samplePages: PageItem[] = [
      makePage(1, '# সূচিপত্র\n\n১. প্রথম অধ্যায় — ২\n২. দ্বিতীয় অধ্যায় — ৪', { isTocPage: true }),
      makePage(2, '# প্রথম অধ্যায়\n\nবাংলার নদী ও প্রকৃতি আমাদের সাহিত্যের চিরন্তন প্রেরণা এবং\n\n২'),
      makePage(3, 'এই প্রেরণা থেকেই অসংখ্য কালজয়ী উপন্যাস ও কাব্য রচিত হয়েছে।\n\n৩'),
      makePage(4, '# দ্বিতীয় অধ্যায়\n\nদ্বিতীয় অধ্যায়ের সূচনা অনুচ্ছেদ এখানে সমাপ্ত হলো।\n\n৪'),
    ];

    const run1 = reconstructDocumentLayoutForEpub(samplePages, { bookDetails: DEFAULT_BOOK, smartSpacing: true });
    const run2 = reconstructDocumentLayoutForEpub(samplePages, { bookDetails: DEFAULT_BOOK, smartSpacing: true });

    assert.equal(
      run1.consolidatedGroups.length,
      run2.consolidatedGroups.length,
      'Repeated conversion must produce identical section count'
    );
    for (let i = 0; i < run1.consolidatedGroups.length; i++) {
      assert.equal(
        run1.consolidatedGroups[i].sectionPage.markdown,
        run2.consolidatedGroups[i].sectionPage.markdown,
        `Section ${i} markdown must be 100% identical across repeated runs`
      );
    }
    // Verify originalOcr on input pages was never mutated or deleted
    assert.equal(
      samplePages[1].originalOcr,
      '# প্রথম অধ্যায়\n\nবাংলার নদী ও প্রকৃতি আমাদের সাহিত্যের চিরন্তন প্রেরণা এবং\n\n২',
      'Input page originalOcr must remain completely untouched'
    );
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 11: Long Document with Many Pages & Chapters + Smart Spacing OFF Toggle
  // ============================================================================
  console.log('Test 11: Long multi-chapter document & Smart Spacing ON vs OFF toggle...');
  {
    const longPages: PageItem[] = [
      makePage(1, '# সূচিপত্র\n\n১. প্রথম অধ্যায় — ২\n২. দ্বিতীয় অধ্যায় — ৬\n৩. তৃতীয় অধ্যায় — ১০', {
        isTocPage: true,
      }),
    ];

    for (let p = 2; p <= 12; p++) {
      const isChapterStart = p === 2 || p === 6 || p === 10;
      const chapHeader =
        p === 2
          ? '# প্রথম অধ্যায়\n\n'
          : p === 6
          ? '# দ্বিতীয় অধ্যায়\n\n'
          : p === 10
          ? '# তৃতীয় অধ্যায়\n\n'
          : '';
      const endsMidSentence = p !== 5 && p !== 9 && p !== 12;
      const body = endsMidSentence
        ? `এই পৃষ্ঠার (${p}) সাহিত্যিক আলোচনা অত্যন্ত তাৎপর্যপূর্ণভাবে এগিয়ে চলেছে এবং`
        : `এই পৃষ্ঠার (${p}) আলোচনার মাধ্যমে বর্তমান অধ্যায়ের সমাপ্তি ঘটল।`;
      longPages.push(makePage(p, `${chapHeader}${body}\n\n${p}`));
    }

    // A: Smart Spacing ON (default)
    const epubSmartOn = await generateEpubBlob(DEFAULT_BOOK, longPages, null, 'noto', undefined, undefined, {
      smartSpacing: true,
    });
    assert.equal(epubSmartOn.validationReport?.isValid, true, 'Long EPUB with Smart Spacing ON must be valid');
    assert.equal(epubSmartOn.layoutReport?.smartSpacingEnabled, true);
    assert.ok(
      epubSmartOn.layoutReport!.crossPageParagraphsMerged >= 6,
      'Smart Spacing ON should merge all mid-sentence cross-page continuations within chapters'
    );

    // B: Smart Spacing OFF (legacy per-page mode)
    const epubSmartOff = await generateEpubBlob(DEFAULT_BOOK, longPages, null, 'noto', undefined, undefined, {
      smartSpacing: false,
    });
    assert.equal(epubSmartOff.validationReport?.isValid, true, 'Long EPUB with Smart Spacing OFF must also be valid');
    assert.equal(epubSmartOff.layoutReport?.smartSpacingEnabled, false);
    assert.equal(
      epubSmartOff.layoutReport?.crossPageParagraphsMerged,
      0,
      'Smart Spacing OFF must NOT merge cross-page paragraphs'
    );

    const zipOff = await JSZip.loadAsync(await epubSmartOff.blob.arrayBuffer());
    // In OFF mode, page_3.xhtml exists as its own standalone file instead of being consolidated into page_2.xhtml
    assert.ok(
      zipOff.file('OEBPS/page_3.xhtml') !== null,
      'Smart Spacing OFF must preserve standalone per-page XHTML files (e.g. OEBPS/page_3.xhtml)'
    );
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 12: Bengali OCR Fragments, Compound Hyphens, Multi-Page Poetry & Stanza Breaks
  // ============================================================================
  console.log('Test 12: Bengali OCR fragments, compound hyphens, multi-page poetry & stanza breaks...');
  {
    const {
      analyzeBengaliBoundaryFragments,
      classifyCrossPageContinuity,
      isPoetryOrVerseBlock,
    } = await import('../src/utils/epubGenerator');

    // 12A: Explicit Boundary Decisions (SAFE_TO_MERGE, SAFE_TO_SEPARATE, UNCERTAIN)
    const safeMerge = classifyCrossPageContinuity(
      'নদীর অপর পাড়ে কাশফুলের সাদা মেলা দেখা যায় এবং',
      'শরতের নীল আকাশে সাদা মেঘের ভেলা ভেসে বেড়ায়।'
    );
    assert.equal(safeMerge.boundaryDecision, 'SAFE_TO_MERGE');
    assert.equal(safeMerge.removeVisualPageGap, true);
    assert.equal(safeMerge.joinSplitWord, false);

    const safeSeparate = classifyCrossPageContinuity(
      'এইভাবে প্রথম অধ্যায়ের সমাপ্তি ঘটল।',
      'দ্বিতীয় অনুচ্ছেদে নতুন প্রসঙ্গের অবতারণা করা হয়েছে।'
    );
    assert.equal(safeSeparate.boundaryDecision, 'SAFE_TO_SEPARATE');
    assert.equal(safeSeparate.removeVisualPageGap, true);
    assert.equal(safeSeparate.shouldMerge, false);

    // 12B: Intentional Bengali Compound & Reduplicated Hyphens vs Split-Word Hyphens
    const compoundFrag = analyzeBengaliBoundaryFragments(
      'মানুষের জীবনে সর্বদা সুখ-',
      'দুঃখ পাশাপাশি অবস্থান করে।'
    );
    assert.equal(compoundFrag.isKnownCompoundOrReduplicated, true, 'সুখ-দুঃখ must be recognized as an intentional compound');
    assert.equal(compoundFrag.canJoinWord, false, 'Must NOT strip hyphen from সুখ-দুঃখ');
    assert.ok(
      compoundFrag.joinedText?.includes('সুখ-দুঃখ'),
      'Compound hyphen in সুখ-দুঃখ must be preserved intact'
    );

    const redupFrag = analyzeBengaliBoundaryFragments(
      'সন্ধ্যার বাতাস ধীরে-',
      'ধীরে বইতে শুরু করল।'
    );
    assert.equal(redupFrag.isKnownCompoundOrReduplicated, true, 'ধীরে-ধীরে must be recognized as reduplicated');
    assert.ok(redupFrag.joinedText?.includes('ধীরে-ধীরে'), 'Reduplicated hyphen in ধীরে-ধীরে must be preserved');

    // Validated split word across page boundary
    const splitWordFrag = analyzeBengaliBoundaryFragments(
      'রবীন্দ্রনাথের সাহিত্যিক প্রতিভার বহুমুখী বিকাশ দেখা যায় তাঁর রচি-',
      'ত ছোটগল্প ও উপন্যাসে।'
    );
    assert.equal(splitWordFrag.canJoinWord, true, 'রচি- + ত must validate as a genuine split word রচিত');
    assert.ok(splitWordFrag.joinedText?.includes('রচিত ছোটগল্প'));

    // Orphaned vowel sign at start of next page -> UNCERTAIN, preserve original text without guessing
    const orphanedKar = classifyCrossPageContinuity(
      'প্রাচীন বাংলার স্থাপত্যশিল্পের নিদর্শ',
      'াগুলো আজও আমাদের বিস্মিত করে।'
    );
    assert.equal(orphanedKar.boundaryDecision, 'UNCERTAIN');
    assert.equal(orphanedKar.shouldMerge, false, 'Orphaned vowel sign must NOT be blindly concatenated');
    assert.equal(orphanedKar.removeVisualPageGap, true, 'Visual page-break gap can still be safely removed');
    assert.equal(orphanedKar.preservedOriginalFragment, true);

    // 12C: Flexible-Meter Poetry (মুক্তক ছন্দ where one line is ~76 chars) & Multi-Page Poetry with Orphan Line
    const flexibleStanza = [
      'আজি এ প্রভাতে রবির কর',
      'কেমনে পশিল প্রাণের পর, অন্ধকারের দুয়ার খুলে আলোর ঝর্ণাধারা নেমে এল ভুবনজুড়ে',
      'কেমনে পশিল গুহার আঁধারে প্রভাতপাখির গান!',
      'না জানি কেন রে এতদিন পরে জাগিয়া উঠিল প্রাণ।',
    ].join('\n');
    assert.equal(
      isPoetryOrVerseBlock(flexibleStanza),
      true,
      'Flexible-meter Bengali stanza where one line is 74 chars must still be recognized as poetry'
    );

    // Multi-page poem where Page 2 ends with a 4-line stanza + a 1-line orphan verse at the bottom,
    // and Page 3 continues with the remaining stanzas
    const multiPagePoem: PageItem[] = [
      makePage(1, '# কাব্যগ্রন্থ: প্রভাতসংগীত'),
      makePage(
        2,
        [
          '# নির্ঝরের স্বপ্নভঙ্গ',
          '',
          flexibleStanza,
          '',
          'জাগিয়া উঠেছে প্রাণ,',
        ].join('\n')
      ),
      makePage(
        3,
        [
          'ওরে উথলি উঠেছে বারি,',
          'ওরে প্রাণের বাসনা প্রাণের আবেগ রুধিয়া রাখিতে নারি।',
          '',
          'থরথর করি কাঁপিছে ভূধর,',
          'শিলা রাশি রাশি পড়িছে খসে।',
        ].join('\n')
      ),
    ];

    const poemRecon = reconstructDocumentLayoutForEpub(multiPagePoem, {
      bookDetails: DEFAULT_BOOK,
      smartSpacing: true,
    });
    const poemDecision = poemRecon.report.decisions.find((d) => d.fromPage === 2 && d.toPage === 3);
    assert.ok(poemDecision, 'Should record boundary decision between Page 2 and Page 3 of multi-page poem');
    assert.equal(
      poemDecision!.boundaryDecision,
      'SAFE_TO_SEPARATE',
      'Orphan single verse line surrounded by poetry stanzas must be protected as SAFE_TO_SEPARATE'
    );
    assert.equal(
      poemDecision!.shouldMergeParagraph,
      false,
      'Orphan verse line at bottom of Page 2 must NEVER be merged into prose with Page 3'
    );
    assert.equal(
      poemDecision!.removeVisualPageGap,
      true,
      'Multi-page poem within the same chapter should still remove the artificial PDF spine page break'
    );

    // 12D: Stanza Break Rendering in EPUB XHTML
    const poemXhtml = markdownToXhtml(poemRecon.consolidatedGroups[1].sectionPage.markdown, [], {
      pageNumber: 2,
    });
    assert.ok(
      poemXhtml.includes('class="verse-line"'),
      'Intra-stanza poetry lines must render with class="verse-line"'
    );
    assert.ok(
      poemXhtml.includes('class="verse-line stanza-end"'),
      'Final line before an intentional stanza break must render with class="verse-line stanza-end"'
    );
  }
  console.log('  PASSED!\n');

  // ============================================================================
  // TEST 13: Context-Aware Text Reconstruction Suite (Cases A through L)
  // ============================================================================
  console.log('Test 13: Context-Aware Text Reconstruction (Cases A–L: unhyphenated split Bengali words, compound protection, unmarked prose poetry & diagnostics)...');
  {
    const {
      analyzeBengaliBoundaryFragments,
      classifyCrossPageContinuity,
      isUnmarkedProsePoetryBlock,
    } = await import('../src/utils/epubGenerator');

    // Case A — Split Bengali Word Without Hyphen (HIGH CONFIDENCE):
    // Page 2 ends mid-sentence with "আন্তর্জা" and Page 3 begins with "তিক মাতৃভাষা দিবস..."
    const caseAPages: PageItem[] = [
      makePage(1, '# প্রথম অধ্যায়\n\nভাষা আন্দোলনের ইতিহাস।'),
      makePage(2, 'একুশে ফেব্রুয়ারি আমাদের জাতীয় জীবনের এক অবিস্মরণীয় দিন এবং বর্তমানে এটি আন্তর্জা'),
      makePage(3, 'তিক মাতৃভাষা দিবস হিসেবে সারা বিশ্বে অত্যন্ত মর্যাদার সাথে পালিত হয়।'),
    ];
    const caseARes = reconstructDocumentLayoutForEpub(caseAPages, {
      bookDetails: DEFAULT_BOOK,
      smartSpacing: true,
    });
    const caseAMergedMarkdown = caseARes.consolidatedGroups[0].sectionPage.markdown;
    assert.ok(
      caseAMergedMarkdown.includes('আন্তর্জাতিক মাতৃভাষা দিবস'),
      'Case A: Unhyphenated split Bengali word ("আন্তর্জা" + "তিক") must be reconstructed into "আন্তর্জাতিক" at HIGH confidence'
    );
    assert.equal(caseARes.report.unhyphenatedWordsReconstructedCount, 1);
    const caseADecision = caseARes.report.decisions.find((d) => d.fromPage === 2 && d.toPage === 3);
    assert.ok(caseADecision, 'Case A decision must be recorded');
    assert.equal(caseADecision!.confidenceLevel, 'HIGH');
    assert.equal(caseADecision!.joinSplitWord, true);
    assert.equal(caseADecision!.diagnostics?.finalDecision, 'RECONSTRUCTED_WORD_AND_MERGED');

    // Also verify bound inflectional suffix reconstruction ("সাহিত্যিক" + "দের" -> "সাহিত্যিকদের")
    const caseABoundSuffix = classifyCrossPageContinuity(
      'বিংশ শতাব্দীর শুরুতে বাংলার প্রখ্যাত সাহিত্যিক',
      'দের রচনায় নতুন মানবতাবাদী চেতনার স্ফুরণ ঘটে।'
    );
    assert.equal(caseABoundSuffix.confidenceLevel, 'HIGH');
    assert.equal(caseABoundSuffix.joinSplitWord, true);
    assert.ok(
      caseABoundSuffix.mergedText?.includes('সাহিত্যিকদের রচনায়'),
      'Case A (bound suffix): "সাহিত্যিক" + "দের" across page boundary must reconstruct into "সাহিত্যিকদের"'
    );

    // Case B — Two Separate Bengali Words That Could Form a Compound Word (DO NOT MERGE):
    // "বাংলা" + "ভাষা", "নদী" + "তীরে", "দেশ" + "কাল" are standalone words even though
    // "বাংলাভাষা", "নদীতীরে", "দেশকাল" are valid Bengali words.
    const caseB1 = classifyCrossPageContinuity(
      'আমাদের প্রাণের প্রিয় মাতৃভাষা হলো বাংলা',
      'ভাষা ও সাহিত্যের ঐতিহ্য হাজার বছরের পুরনো।'
    );
    assert.equal(caseB1.shouldMerge, true, 'Case B: Continuing sentence across pages should merge paragraph');
    assert.equal(
      caseB1.joinSplitWord,
      false,
      'Case B: Two standalone words ("বাংলা" + "ভাষা") must NEVER be joined into a single word'
    );
    assert.ok(
      caseB1.mergedText?.includes('বাংলা ভাষা ও সাহিত্যের'),
      'Case B: Space between standalone words "বাংলা" and "ভাষা" must be strictly preserved'
    );

    const caseB2 = classifyCrossPageContinuity(
      'বিকেলের নরম আলোয় আমরা হাঁটছিলাম শান্ত নদী',
      'তীরে বসে মাঝিদের ভাটিয়ালি গান শুনছিলাম।'
    );
    assert.equal(caseB2.joinSplitWord, false, 'Case B: "নদী" + "তীরে" must NOT be concatenated into "নদীতীরে"');
    assert.ok(caseB2.mergedText?.includes('নদী তীরে বসে'));

    // Case C & Case D — Paragraph Continuing vs Paragraph Ending at Page Bottom (with Geometry Verification)
    const caseCGeo = classifyCrossPageContinuity(
      'গ্রামীণ অর্থনীতির মূল ভিত্তি কৃষি এবং',
      'নদীর পলিমাটি প্রতি বছর জমিকে উর্বর করে তোলে।',
      false,
      {
        prevPageLayoutBlocks: [{ text: 'গ্রামীণ অর্থনীতির মূল ভিত্তি কৃষি এবং', x: 50, y: 760, width: 490, height: 18 }],
        nextPageLayoutBlocks: [
          { text: 'নদীর পলিমাটি প্রতি বছর জমিকে উর্বর করে তোলে।', x: 50, y: 60, width: 485, height: 18 },
          { text: 'ফলে ফসলের উৎপাদন বৃদ্ধি পায়।', x: 50, y: 84, width: 420, height: 18 },
        ],
        pageWidth: 600,
      }
    );
    assert.equal(caseCGeo.shouldMerge, true);
    assert.equal(caseCGeo.confidenceLevel, 'HIGH');
    assert.equal(caseCGeo.diagnostics.visualVerificationPerformed, true);

    const caseDGeo = classifyCrossPageContinuity(
      'এখানেই প্রথম অনুচ্ছেদের আলোচনা শেষ হলো।',
      '    নতুন অনুচ্ছেদে আমরা দ্বিতীয় বিষয়ের অবতারণা করব।',
      false,
      {
        prevPageLayoutBlocks: [{ text: 'এখানেই প্রথম অনুচ্ছেদের আলোচনা শেষ হলো।', x: 50, y: 760, width: 260, height: 18 }],
        nextPageLayoutBlocks: [
          { text: 'নতুন অনুচ্ছেদে আমরা দ্বিতীয় বিষয়ের অবতারণা করব।', x: 75, y: 60, width: 460, height: 18 },
          { text: 'দ্বিতীয় লাইনের বাম মার্জিন স্বাভাবিক।', x: 50, y: 84, width: 485, height: 18 },
        ],
        pageWidth: 600,
      }
    );
    assert.equal(caseDGeo.shouldMerge, false);
    assert.equal(caseDGeo.classification, 'NEW_PARAGRAPH');
    assert.equal(caseDGeo.diagnostics.visualVerificationPerformed, true);

    // Case G — Unmarked Prose Poetry (গদ্যকবিতা) Protection:
    const unmarkedProsePoemBlock1 =
      'হে নীরব রাত্রি — তুমি নেমে এসো আমার নির্জন প্রাণের গভীরে; হে সুদূর নক্ষত্র — তুমি জ্বালো তোমার অনন্ত আলোর প্রদীপ; হে ক্লান্ত হৃদয় — তুমি খুঁজে নাও তোমার চিরন্তন বিশ্রাম...';
    const unmarkedProsePoemBlock2 =
      'আমি শুনেছি সেই অসীম আকাশের ডাক — আমি দেখেছি কুয়াশার ভেতর জ্যোৎস্নার ছায়া; আমি জেনেছি বিরহের নীরবতা কতটা গভীর হতে পারে!';

    const prosePoetryCheck1 = isUnmarkedProsePoetryBlock(unmarkedProsePoemBlock1);
    assert.equal(
      prosePoetryCheck1.isProsePoetry,
      true,
      'Case G: Full-width lyrical Bengali prose poetry with anaphora and rhythmic pause cadence must be detected'
    );

    const caseGContinuity = classifyCrossPageContinuity(unmarkedProsePoemBlock1, unmarkedProsePoemBlock2);
    assert.equal(
      caseGContinuity.shouldMerge,
      false,
      'Case G: Unmarked prose poetry blocks must NEVER be merged into ordinary prose across page boundaries'
    );
    assert.equal(caseGContinuity.classification, 'STRUCTURED_CONTENT');

    // Case K — Corrupted or Uncertain OCR Fragments (Medium & Low Confidence):
    const mediumUnverifiedFrag = analyzeBengaliBoundaryFragments(
      'তাঁর গবেষণার মূল বিষয় ছিল মনোবিজ্ঞা',
      'নীদের নতুন তত্ত্বের বিশ্লেষণ।',
      { allowUnhyphenatedCrossPageWordJoin: true }
    );
    assert.equal(
      mediumUnverifiedFrag.canJoinWord,
      false,
      'Case K: Unverified unhyphenated fragment not in verified dictionary/suffix list must NOT be auto-merged'
    );
    assert.equal(mediumUnverifiedFrag.isAmbiguousFragment, true);
    assert.equal(mediumUnverifiedFrag.wordConfidenceLevel, 'MEDIUM');
    assert.equal(mediumUnverifiedFrag.proposedWordReconstruction, 'মনোবিজ্ঞানীদের');

    const caseKEval = classifyCrossPageContinuity(
      'তাঁর গবেষণার মূল বিষয় ছিল মনোবিজ্ঞা',
      'নীদের নতুন তত্ত্বের বিশ্লেষণ।'
    );
    assert.equal(caseKEval.shouldMerge, false);
    assert.equal(caseKEval.boundaryDecision, 'UNCERTAIN');
    assert.equal(caseKEval.confidenceLevel, 'MEDIUM');
    assert.equal(caseKEval.diagnostics.finalDecision, 'FLAGGED_UNCERTAIN_PRESERVED');
    assert.ok(
      caseKEval.diagnostics.proposedReconstruction.includes('মনোবিজ্ঞানীদের'),
      'Case K: Diagnostics must record the proposed reconstruction while preserving the original text in EPUB output'
    );
  }
  console.log('  PASSED!\n');

  // ---------------------------------------------------------------------------
  // TEST 14: Smart Cross-Page Paragraph Continuation (Mughal Example & Cases 1-12)
  // ---------------------------------------------------------------------------
  console.log('Test 14: Smart Cross-Page Paragraph Continuation (Mughal Example & Cases 1-12)...');
  {
    // Exact User Prompt Example (both unquoted and artificially quoted per page):
    const mughalUnquotedEval = classifyCrossPageContinuity(
      'এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য',
      'উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে…'
    );
    assert.equal(mughalUnquotedEval.shouldMerge, true, 'Mughal example (unquoted) must merge across pages');
    assert.equal(mughalUnquotedEval.classification, 'SAME_PARAGRAPH');
    assert.equal(mughalUnquotedEval.boundaryDecision, 'SAFE_TO_MERGE');
    assert.equal(mughalUnquotedEval.confidenceLevel, 'HIGH');
    assert.equal(
      mughalUnquotedEval.mergedText,
      'এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে…'
    );

    const mughalQuotedEval = classifyCrossPageContinuity(
      '“এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য”',
      '“উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে…”'
    );
    assert.equal(mughalQuotedEval.shouldMerge, true, 'Mughal example (quoted per page) must merge across pages');
    assert.equal(mughalQuotedEval.classification, 'SAME_PARAGRAPH');
    assert.equal(
      mughalQuotedEval.mergedText,
      '“এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে…”',
      'Redundant inner page-boundary quotes must be stripped when merging a continuous quoted sentence'
    );

    // HTML <p>...</p> wrapper normalization check:
    const htmlWrappedEval = classifyCrossPageContinuity(
      '<p>এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য</p>',
      '<p>উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে…</p>'
    );
    assert.equal(htmlWrappedEval.shouldMerge, true);
    assert.equal(
      htmlWrappedEval.mergedText,
      '<p>এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে…</p>',
      'HTML <p> wrappers must be merged into a single <p> element without nested or consecutive <p> tags'
    );

    // Case 1: Paragraph split across two pages in the middle of a sentence -> Merged into one continuous paragraph
    const case1 = classifyCrossPageContinuity(
      'মোগল সাম্রাজ্যের ইতিহাস পর্যালোচনা করলে দেখা যায় সম্রাট আকবরের শাসনামলে রাজস্ব ব্যবস্থার আমূল',
      'পরিবর্তন ঘটেছিল এবং সাধারণ কৃষকদের জন্য নতুন নিয়ম প্রবর্তন করা হয়েছিল।'
    );
    assert.equal(case1.shouldMerge, true, 'Case 1: Mid-sentence split across two pages must merge');
    assert.equal(case1.joinSplitWord, false, 'Case 1: Complete words must be separated by a single space');
    assert.ok(case1.mergedText?.includes('আমূল পরিবর্তন ঘটেছিল'));

    // Case 2: Paragraph split across two pages AND a word is split across the boundary -> Word reconstructed AND paragraph merged
    const case2 = classifyCrossPageContinuity(
      'তৎকালীন ভারতবর্ষের ব্যবসা-বাণিজ্য ও আন্তর্জা',
      'তিক সম্পর্কের ক্ষেত্রে বন্দরগুলোর ভূমিকা ছিল অপরিসীম।'
    );
    assert.equal(case2.shouldMerge, true, 'Case 2: Paragraph must merge');
    assert.equal(case2.joinSplitWord, true, 'Case 2: Split word must be reconstructed');
    assert.ok(case2.mergedText?.includes('আন্তর্জাতিক সম্পর্কের'));

    // Case 3: Page ends with a completed paragraph and the next page starts a new paragraph -> Separate paragraphs preserved
    const case3 = classifyCrossPageContinuity(
      'এভাবেই প্রথম অধ্যায়ের ঐতিহাসিক পটভূমি আলোচনা সমাপ্ত হলো।',
      '    পরবর্তী সময়ে সম্রাট জাহাঙ্গীরের শাসনামলে চিত্রশিল্পের নতুন বিকাশ ঘটে।'
    );
    assert.equal(case3.shouldMerge, false, 'Case 3: Completed paragraph + indented new paragraph must stay separate');
    assert.equal(case3.classification, 'NEW_PARAGRAPH');

    // Case 4: Next page begins with a chapter title or section heading -> Never merged
    const case4a = classifyCrossPageContinuity(
      'এই ঘটনার মধ্য দিয়ে একটি যুগের অবসান ঘটে',
      '# তৃতীয় অধ্যায়: নতুন দিগন্ত',
      true
    );
    assert.equal(case4a.shouldMerge, false, 'Case 4a: Chapter title must never merge');
    assert.equal(case4a.classification, 'NEW_CHAPTER');

    const case4b = classifyCrossPageContinuity(
      'এই ঘটনার মধ্য দিয়ে একটি যুগের অবসান ঘটে',
      '## দ্বিতীয় পরিচ্ছেদ: আগ্রার দুর্গ',
      false
    );
    assert.equal(case4b.shouldMerge, false, 'Case 4b: Section heading must never merge');
    assert.equal(case4b.classification, 'NEW_HEADING');

    // Case 5: Poetry or verse spans across pages -> Line breaks and stanza structure preserved
    const case5 = classifyCrossPageContinuity(
      'আলো আমার আলো ওগো\nআলো ভুবন ভরা\nআলো নয়ন ধোওয়া আমার',
      'আলো হৃদয় হরা\nনাচে আলো নাচে ও ভাই\nআমার প্রাণের কাছে'
    );
    assert.equal(case5.shouldMerge, false, 'Case 5: Poetry stanzas must never be flattened into prose');
    assert.equal(case5.classification, 'STRUCTURED_CONTENT');

    // Case 6: Unmarked prose poetry (গদ্যকবিতা) spans across pages -> Poetic structure preserved
    const case6 = classifyCrossPageContinuity(
      'হে নীরব রাত্রি — তুমি নেমে এসো আমার নির্জন প্রাণের গভীরে; হে সুদূর নক্ষত্র — তুমি জ্বালো তোমার অনন্ত আলোর প্রদীপ; হে ক্লান্ত হৃদয় — তুমি খুঁজে নাও তোমার চিরন্তন বিশ্রাম...',
      'আমি শুনেছি সেই অসীম আকাশের ডাক — আমি দেখেছি কুয়াশার ভেতর জ্যোৎস্নার ছায়া; আমি জেনেছি বিরহের নীরবতা কতটা গভীর হতে পারে!'
    );
    assert.equal(case6.shouldMerge, false, 'Case 6: Unmarked prose poetry must be preserved');
    assert.equal(case6.classification, 'STRUCTURED_CONTENT');

    // Case 7: Running headers, footers, or page numbers appear between split paragraph fragments -> Ignored and paragraph merged cleanly
    // Case 9: A paragraph continues across three consecutive pages -> Merged cleanly across all continuing pages
    const multiPageBooks: PageItem[] = [
      {
        pageNumber: 1,
        status: 'completed',
        markdown:
          'মুঘল সম্রাটদের রাজদরবারের ইতিহাস\n\n# প্রথম অধ্যায়: দরবারের কথা\n\nএটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য\n\n১২',
        figures: [],
        hasImages: false,
      },
      {
        pageNumber: 2,
        status: 'completed',
        markdown:
          'মুঘল সম্রাটদের রাজদরবারের ইতিহাস\n\nউন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে এবং তৎকালীন সমাজ ও সংস্কৃতির গভীর পটভূমি\n\n১৩',
        figures: [],
        hasImages: false,
      },
      {
        pageNumber: 3,
        status: 'completed',
        markdown:
          'মুঘল সম্রাটদের রাজদরবারের ইতিহাস\n\nপাঠকদের সামনে অত্যন্ত সহজ ও সাবলীল ভাষায় তুলে ধরবে।\n\nদ্বিতীয় অনুচ্ছেদে আমরা সম্রাট বাবরের আত্মজীবনী বাবরনামা সম্পর্কে বিস্তারিত জানব।\n\n১৪',
        figures: [],
        hasImages: false,
      },
    ];
    const tocMulti: EpubTocItem[] = [
      {
        id: 'toc_ch_1',
        title: 'প্রথম অধ্যায়: দরবারের কথা',
        pageNumber: '1',
        targetPageNumber: 1,
        targetHref: 'page_1.xhtml#ch_1',
        level: 1,
        children: [],
      },
    ];
    const multiResult = reconstructDocumentLayoutForEpub(multiPageBooks, tocMulti, { smartSpacing: true });
    assert.equal(multiResult.consolidatedGroups.length, 1, 'Pages 1, 2, 3 must consolidate into 1 chapter section');
    assert.equal(
      multiResult.report.crossPageParagraphsMerged,
      2,
      'Case 7 & Case 9: Paragraph continuing across 3 consecutive pages (with running headers/footers stripped) must merge across both page boundaries'
    );
    assert.ok(
      multiResult.consolidatedGroups[0].sectionPage.markdown.includes(
        'এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে এবং তৎকালীন সমাজ ও সংস্কৃতির গভীর পটভূমি পাঠকদের সামনে অত্যন্ত সহজ ও সাবলীল ভাষায় তুলে ধরবে।'
      ),
      'Case 9: All three page fragments must form a single continuous paragraph'
    );

    // Verify full EPUB generation produces a single <p> element for the 3-page continuous paragraph
    const { blob: multiEpubBlob } = await generateEpubBlob(
      {
        title: 'মুঘল সম্রাটদের রাজদরবারের ইতিহাস',
        author: 'ইতিহাসবিদ',
        publisher: 'বাংলা প্রকাশনী',
        genre: 'ইতিহাস',
        language: 'bn',
      },
      multiPageBooks,
      null,
      'noto',
      undefined,
      undefined,
      { smartSpacing: true }
    );
    const multiZip = await JSZip.loadAsync(await multiEpubBlob.arrayBuffer());
    const page1Xhtml = await multiZip.file('OEBPS/page_1.xhtml')!.async('string');
    assert.ok(
      /<p[^>]*>[^<]*এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে এবং তৎকালীন সমাজ ও সংস্কৃতির গভীর পটভূমি পাঠকদের সামনে অত্যন্ত সহজ ও সাবলীল ভাষায় তুলে ধরবে।[^<]*<\/p>/.test(
        page1Xhtml
      ),
      'Generated EPUB XHTML must contain the entire 3-page paragraph inside a single unbroken <p> element without internal page anchors splitting the text'
    );

    // Case 8: A page ends with punctuation, but the paragraph continues -> Correctly handled using combined signals
    // 8a: Ends with ellipsis / comma / dash
    const case8a = classifyCrossPageContinuity(
      'সম্রাট শাহজাহানের স্থাপত্যশিল্পের অন্যতম নিদর্শন তাজমহল, লালকেল্লা এবং—',
      'জামে মসজিদ আজও বিশ্ববাসীকে মুগ্ধ করে চলেছে।'
    );
    assert.equal(case8a.shouldMerge, true, 'Case 8a: Page ending with clause punctuation/dash must merge');

    // 8b: Ends with terminal danda (।) inside an unclosed multi-sentence quotation spanning across the page boundary
    const case8b = classifyCrossPageContinuity(
      'ঐতিহাসিক আবুল ফজল লিখেছেন, “সম্রাট আকবর প্রতিদিন ভোরে প্রজাদের অভাব-অভিযোগ মনোযোগ দিয়ে শুনতেন।',
      'তিনি বিশ্বাস করতেন প্রজাদের কল্যাণের মধ্যেই সাম্রাজ্যের প্রকৃত শক্তি নিহিত।”'
    );
    assert.equal(
      case8b.shouldMerge,
      true,
      'Case 8b: Page ending with danda (।) inside an unclosed multi-sentence quotation must continue the same paragraph'
    );
    assert.equal(case8b.classification, 'SAME_PARAGRAPH');

    // 8c: Ends with terminal danda (।) at the right margin (geometry verified) and next page starts flush-left with discourse continuation
    const case8c = classifyCrossPageContinuity(
      'দুর্ভিক্ষের সময় রাজকোষ থেকে প্রজাদের জন্য নিঃশর্ত খাদ্যশস্য বিতরণ করা হয়েছিল।',
      'ফলে সেই অঞ্চলে মহামারী ও অনাহারের প্রকোপ দ্রুত নিয়ন্ত্রণে চলে আসে।',
      false,
      {
        prevPageLayoutBlocks: [
          {
            text: 'দুর্ভিক্ষের সময় রাজকোষ থেকে প্রজাদের জন্য নিঃশর্ত খাদ্যশস্য বিতরণ করা হয়েছিল।',
            x: 50,
            y: 760,
            width: 495,
            height: 18,
          },
        ],
        nextPageLayoutBlocks: [
          {
            text: 'ফলে সেই অঞ্চলে মহামারী ও অনাহারের প্রকোপ দ্রুত নিয়ন্ত্রণে চলে আসে।',
            x: 50,
            y: 60,
            width: 485,
            height: 18,
          },
          {
            text: 'পরবর্তী অনুচ্ছেদের প্রথম লাইনটি ডানদিকে ইন্ডেন্ট করা।',
            x: 75,
            y: 100,
            width: 460,
            height: 18,
          },
        ],
        pageWidth: 600,
      }
    );
    assert.equal(
      case8c.shouldMerge,
      true,
      'Case 8c: Page ending with danda (।) at full right margin followed by flush-left discourse continuation must merge'
    );

    // Case 10: Dialogue or quoted speech spans across pages -> Merged only when it is a continuation of the same paragraph
    // 10a: Same speaker's unclosed quote continues across page -> Merge
    const case10a = classifyCrossPageContinuity(
      'বীরবল মৃদু হেসে সম্রাটকে বললেন, “জাঁহাপনা, মানুষের প্রজ্ঞা ও ধৈর্যই তাকে বিপদের সময়',
      'সঠিক পথ দেখাতে পারে এবং সত্যের সন্ধান দেয়।”'
    );
    assert.equal(case10a.shouldMerge, true, 'Case 10a: Continuing quoted speech must merge');

    // 10b: Completed quoted speech followed by a new speaker's quoted reply on next page -> Keep separate
    const case10b = classifyCrossPageContinuity(
      'সম্রাট প্রশ্ন করলেন, “এই সমস্যার সমাধান কী?”',
      '“জাঁহাপনা, আমাদের প্রথমে প্রজাদের কথা শুনতে হবে,” মন্ত্রী উত্তর দিলেন।'
    );
    assert.equal(case10b.shouldMerge, false, 'Case 10b: Distinct dialogue turns must remain separate paragraphs');
    assert.equal(case10b.classification, 'NEW_PARAGRAPH');

    // Case 11: Lists, tables, footnotes, captions, or blockquotes appear at page boundaries -> Preserved properly
    const case11List = classifyCrossPageContinuity(
      'মুঘল প্রশাসনের প্রধান বিভাগগুলো নিচে উল্লেখ করা হলো',
      '১. রাজস্ব ও অর্থ বিভাগ\n২. সামরিক ও মনসবদারি বিভাগ'
    );
    assert.equal(case11List.shouldMerge, false, 'Case 11: Numbered list must never be merged into preceding paragraph');

    const case11Caption = classifyCrossPageContinuity(
      'আগ্রার দুর্গের স্থাপত্যশৈলী পর্যটকদের মুগ্ধ করে',
      'চিত্র ১.২: আগ্রার লালকেল্লার প্রধান ফটক'
    );
    assert.equal(case11Caption.shouldMerge, false, 'Case 11: Figure caption must never be merged');

    // Case 12: Ambiguous boundary with insufficient evidence -> Original separation preserved safely
    const case12 = classifyCrossPageContinuity(
      'তাঁর লেখায় আমরা দেখতে পাই অদ্ভুত সংস্কা্',
      'রের এক নতুন ধারা।'
    );
    assert.equal(case12.shouldMerge, false, 'Case 12: Ambiguous OCR boundary must preserve separation safely');
    assert.equal(case12.boundaryDecision, 'UNCERTAIN');
    assert.equal(case12.preservedOriginalFragment, true);
  }
  console.log('  PASSED!\n');

  // ---------------------------------------------------------------------------
  // TEST 15: Real End-to-End Pipeline Reproduction (Tests A through G)
  // ---------------------------------------------------------------------------
  console.log('Test 15: Real End-to-End Pipeline Reproduction (Tests A–G: Mughal real-world pipeline, noisy layoutBlocks, OCR HTML wrappers, TOC offset collision & EPUB XHTML verification)...');
  {
    const { isTableOfContentsText, isLikelyTocPage } = await import('../src/utils/epubGenerator');

    // Test A & Test G: Real Pipeline Reproduction (Mughal Example) under real OCR/PDF conditions:
    // 1. Prose mentioning "বিষয়বস্তু" (which previously triggered false-positive isTocPage = true)
    // 2. OCR wrapping paragraphs in <p class="text-left"> / <p class="indent-1"> or multi-line soft breaks (\n)
    // 3. Noisy PDF layoutBlocks (centered watermark/running header at x=220 on an 810px scaled canvas, short footer at bottom)
    // 4. Printed TOC target page offset pointing at Page 3 (which is actually a mid-sentence continuation of Page 2)
    const mughalBookDetails: BookDetails = {
      title: 'মুঘল হেরেমের অন্তরালে',
      author: 'ইতিহাস গবেষক',
      publisher: 'ঐতিহ্য প্রকাশনী',
      language: 'bn',
      description: 'মুঘল সম্রাটদের একান্ত জীবনের ইতিহাস',
    };

    const page1Toc = makePage(
      1,
      '# সূচিপত্র\n\nভূমিকা — ২\nপ্রথম অধ্যায় — ৩',
      { isTocPage: true }
    );

    const page2MughalN = makePage(
      2,
      [
        '# ভূমিকা',
        '',
        '<p class="text-left">এই গ্রন্থের মূল বিষয়বস্তু হলো মধ্যযুগের ইতিহাস। সম্রাট বাবর থেকে আওরঙ্গজেব পর্যন্ত শাসকদের দরবারি জীবনের পাশাপাশি তাঁদের ব্যক্তিগত জীবনও ছিল বৈচিত্র্যময়।</p>',
        '<p class="text-left">“এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের\nএকান্ত জীবনের অনেক রহস্য”</p>',
        '২',
      ].join('\n'),
      {
        // Simulate stale false-positive isTocPage from "বিষয়বস্তু" in prose
        isTocPage: isTableOfContentsText(
          'এই গ্রন্থের মূল বিষয়বস্তু হলো মধ্যযুগের ইতিহাস। এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য'
        ),
        layoutBlocks: [
          { text: 'ভূমিকা', x: 350, y: 40, width: 110, height: 22 },
          { text: 'এই গ্রন্থের মূল বিষয়বস্তু হলো মধ্যযুগের ইতিহাস।', x: 60, y: 90, width: 680, height: 18 },
          { text: 'এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য', x: 60, y: 710, width: 675, height: 18 },
          // Short centered footer / page number block at bottom that previously triggered prevLineShortParagraphEnd (-0.25)
          { text: '২', x: 395, y: 780, width: 15, height: 14 },
        ],
      }
    );

    const page3MughalNPlus1 = makePage(
      3,
      [
        'ভূমিকা',
        '<p class="indent-1">“উন্মোচন করবে, অনেক অজানা তথ্য\nসামনে নিয়ে আসবে…”</p>',
        '<p class="indent-1">পরবর্তী অধ্যায়ে আমরা আগ্রা ও দিল্লির রাজপ্রাসাদের অন্দরমহলের ঐতিহাসিক বিবরণ তুলে ধরব।</p>',
        '৩',
      ].join('\n'),
      {
        layoutBlocks: [
          // Centered running header block at top that previously triggered nextLineGeometryIndented (-0.30 & blocked Signal 3)
          { text: 'ভূমিকা', x: 360, y: 35, width: 90, height: 16 },
          { text: 'উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে…', x: 60, y: 80, width: 520, height: 18 },
          { text: 'পরবর্তী অধ্যায়ে আমরা আগ্রা ও দিল্লির রাজপ্রাসাদের অন্দরমহলের ঐতিহাসিক বিবরণ তুলে ধরব।', x: 84, y: 120, width: 650, height: 18 },
          { text: '৩', x: 395, y: 780, width: 15, height: 14 },
        ],
      }
    );

    assert.equal(
      page2MughalN.isTocPage,
      false,
      'Prose page containing the word "বিষয়বস্তু" must NOT be classified as a Table of Contents page'
    );
    assert.equal(
      isLikelyTocPage(page2MughalN, [page1Toc, page2MughalN, page3MughalNPlus1]),
      false,
      'isLikelyTocPage must return false for prose pages mentioning "বিষয়বস্তু"'
    );

    // Test FinalExportModal call signature (passing tocTree as 2nd arg OR inside options object)
    const simulatedTocTree: EpubTocItem[] = [
      {
        id: 'toc_1',
        title: 'ভূমিকা',
        pageNumber: '2',
        targetPageNumber: 2,
        targetHref: 'page_2.xhtml',
        level: 1,
        children: [],
      },
      // Simulate printed TOC offset pointing "প্রথম অধ্যায়" to PDF page 3 even though page 3 starts with a continuation of page 2
      {
        id: 'toc_2',
        title: 'প্রথম অধ্যায়',
        pageNumber: '3',
        targetPageNumber: 3,
        targetHref: 'page_3.xhtml',
        level: 1,
        children: [],
      },
    ];

    const modalPreviewRecon = reconstructDocumentLayoutForEpub(
      [page1Toc, page2MughalN, page3MughalNPlus1],
      simulatedTocTree,
      {
        smartSpacing: true,
        bookDetails: mughalBookDetails,
        identifiedTocPageNums: new Set([1]),
      }
    );

    assert.equal(
      modalPreviewRecon.consolidatedGroups.length,
      1,
      'Test A & B: Page 2 and Page 3 must consolidate into a single section despite running header "ভূমিকা" and TOC offset collision'
    );
    assert.equal(
      modalPreviewRecon.report.crossPageParagraphsMerged,
      1,
      'Test A: The split Mughal paragraph across Page 2 and Page 3 must be merged'
    );

    const previewReaderMarkdown = modalPreviewRecon.consolidatedGroups[0].sectionPage.markdown;
    const expectedMergedMughal =
      '“এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে…”';
    assert.ok(
      previewReaderMarkdown.includes(expectedMergedMughal),
      `Test A & F: Reconstructed Reader Preview markdown must contain the exact continuous paragraph with a single space between "রহস্য" and "উন্মোচন". Got:\n${previewReaderMarkdown}`
    );
    assert.ok(
      !previewReaderMarkdown.includes('রহস্যউন্মোচন'),
      'Test F: Standalone words "রহস্য" and "উন্মোচন" must NEVER be concatenated without a space'
    );

    // Test G: Exported EPUB XHTML Verification
    const { blob: realMughalEpubBlob, layoutReport: realMughalReport } = await generateEpubBlob(
      mughalBookDetails,
      [page1Toc, page2MughalN, page3MughalNPlus1],
      null,
      'noto',
      undefined,
      undefined,
      { smartSpacing: true }
    );
    assert.equal(realMughalReport?.crossPageParagraphsMerged, 1, 'Test G: generateEpubBlob must report 1 merged cross-page paragraph');

    const realMughalZip = await JSZip.loadAsync(await realMughalEpubBlob.arrayBuffer());
    assert.ok(
      realMughalZip.file('OEBPS/page_2.xhtml') !== null,
      'Test G: Consolidated chapter file OEBPS/page_2.xhtml must exist in EPUB archive'
    );
    assert.equal(
      realMughalZip.file('OEBPS/page_3.xhtml'),
      null,
      'Test G: Continuation Page 3 must be consolidated into page_2.xhtml, not emitted as a separate page_3.xhtml spine item'
    );

    const page2XhtmlContent = await realMughalZip.file('OEBPS/page_2.xhtml')!.async('string');
    const singleParagraphRegex =
      /<p[^>]*>\s*“এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে…”\s*<\/p>/;
    assert.ok(
      singleParagraphRegex.test(page2XhtmlContent),
      `Test G: Final exported EPUB XHTML must contain the merged Mughal sentence inside a single <p> element without </p><p> or <br/> splits. Actual XHTML:\n${page2XhtmlContent}`
    );

    // Test C: True New Paragraph (Page N ends with । and Page N+1 starts a genuinely new indented paragraph -> 2 separate <p> elements)
    const testCPages: PageItem[] = [
      makePage(1, '# প্রথম অধ্যায়\n\nসম্রাট আকবরের শাসনামলে রাজস্ব ব্যবস্থার সংস্কার সম্পন্ন হয়েছিল।'),
      makePage(2, '<p class="indent-1">পরবর্তী সময়ে সম্রাট জাহাঙ্গীরের দরবারে চিত্রশিল্পের অভূতপূর্ব বিকাশ ঘটে।</p>'),
    ];
    const { blob: testCEpub } = await generateEpubBlob(
      mughalBookDetails,
      testCPages,
      null,
      'noto',
      undefined,
      undefined,
      { smartSpacing: true }
    );
    const testCZip = await JSZip.loadAsync(await testCEpub.arrayBuffer());
    const testCXhtml = await testCZip.file('OEBPS/page_1.xhtml')!.async('string');
    assert.ok(
      /<p[^>]*>সম্রাট আকবরের শাসনামলে রাজস্ব ব্যবস্থার সংস্কার সম্পন্ন হয়েছিল।<\/p>/.test(testCXhtml) &&
        /<p[^>]*>পরবর্তী সময়ে সম্রাট জাহাঙ্গীরের দরবারে চিত্রশিল্পের অভূতপূর্ব বিকাশ ঘটে।<\/p>/.test(testCXhtml),
      'Test C: Completed paragraph followed by an indented new paragraph must remain two separate <p> elements in exported EPUB XHTML'
    );

    // Test D & E: Chapter/Heading Boundary & Poetry/Prose-Poetry Boundary in Full EPUB Export
    const testDEPages: PageItem[] = [
      makePage(1, '# প্রথম অধ্যায়\n\nআলো আমার আলো ওগো\nআলো ভুবন ভরা\nআলো নয়ন ধোওয়া আমার'),
      makePage(2, 'আলো হৃদয় হরা\nনাচে আলো নাচে ও ভাই\nআমার প্রাণের কাছে'),
      makePage(3, '# দ্বিতীয় অধ্যায়\n\nনতুন অধ্যায়ের সূচনা পঙক্তি।'),
    ];
    const { blob: testDEEpub, layoutReport: testDEReport } = await generateEpubBlob(
      mughalBookDetails,
      testDEPages,
      null,
      'noto',
      undefined,
      undefined,
      { smartSpacing: true }
    );
    assert.equal(testDEReport?.crossPageParagraphsMerged, 0, 'Test D & E: Poetry stanzas and new chapter headings must never merge');
    const testDEZip = await JSZip.loadAsync(await testDEEpub.arrayBuffer());
    assert.ok(testDEZip.file('OEBPS/page_1.xhtml') !== null, 'Chapter 1 file must exist');
    assert.ok(testDEZip.file('OEBPS/page_3.xhtml') !== null, 'Test D: Chapter 2 must start on its own XHTML file (page_3.xhtml)');
  }
  console.log('  PASSED!\n');

  console.log('All 15 Intelligent EPUB Layout Reconstruction & Smart Cross-Page Paragraph Continuation test suites passed!');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});



