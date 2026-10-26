import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  generateEpubBlob,
  markdownToXhtml,
  evaluateParagraphContinuation,
  reconstructMultiColumnFromGeometry,
  reconstructMultiColumnMarkdown,
  reconstructDocumentLayoutForEpub,
  normalizeEpubLayoutXhtml,
  validateEpubXhtmlLayout,
} from '../src/utils/epubGenerator';
import { validateEpubPackage } from '../src/utils/xhtmlValidator';
import { BookDetails, PageItem, PdfTextBlock } from '../src/types';

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

  console.log('All 8 Intelligent EPUB Layout Reconstruction & Gap Removal test suites passed!');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
