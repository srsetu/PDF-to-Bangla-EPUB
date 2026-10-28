import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  generateEpubBlob,
  markdownToXhtml,
  isGenericFigurePlaceholderCaption,
} from '../src/utils/epubGenerator';
import { sanitizePagesForExport } from '../src/utils/bengaliOcrPipeline';
import { extractAuthoritativeTocTree } from '../src/utils/tocExtractor';
import { reconstructDocumentLayoutForEpub } from '../src/utils/epubLayoutPipeline';
import { PageItem, BookDetails, PageFigure } from '../src/types';

const samplePng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const defaultBook: BookDetails = {
  title: 'মুঘল সাম্রাজ্যের ইতিহাস',
  author: 'ড. আবদুল করিম',
  publisher: 'ইতিহাস প্রকাশনী',
  publishYear: '২০২৪',
  isbn: '978-984-000-001',
  language: 'bn',
};

function buildRepresentativeBook(numPages = 40): PageItem[] {
  const pages: PageItem[] = [];
  pages.push({
    id: 'p-1',
    pageNumber: 1,
    imageUrl: '',
    status: 'completed',
    markdown: '# মুঘল সাম্রাজ্যের ইতিহাস\n\nড. আবদুল করিম',
  });
  pages.push({
    id: 'p-2',
    pageNumber: 2,
    imageUrl: '',
    status: 'completed',
    markdown:
      '# সূচিপত্র\n\nঅধ্যায় ১: বাবরের ভারত অভিযান ............ ৩\nঅধ্যায় ২: হুমায়ুনের শাসনকাল ............ ১২\nঅধ্যায় ৩: আকবরের সংস্কার ও প্রশাসন ............ ২২\nঅধ্যায় ৪: স্থাপত্য ও চিত্রকলা ............ ৩২',
    isTocPage: true,
  });
  for (let i = 3; i <= numPages; i++) {
    const chapHeading =
      i === 3
        ? '# অধ্যায় ১: বাবরের ভারত অভিযান\n\n'
        : i === 12
        ? '# অধ্যায় ২: হুমায়ুনের শাসনকাল\n\n'
        : i === 22
        ? '# অধ্যায় ৩: আকবরের সংস্কার ও প্রশাসন\n\n'
        : i === 32
        ? '# অধ্যায় ৪: স্থাপত্য ও চিত্রকলা\n\n'
        : '';
    const hasFig = i % 5 === 0;
    const figBlock = hasFig
      ? '\n\n[IMAGE_FIGURE: {"type":"illustration","box_2d":[200,100,500,800]}]\n\n'
      : '\n\n';
    const bodyStart =
      i % 2 === 1
        ? 'এটি আমাদের সাধারণ পাঠকদের জন্য মুঘল সম্রাটদের একান্ত জীবনের অনেক রহস্য উন্মোচন করবে, অনেক অজানা তথ্য সামনে নিয়ে আসবে। তৎকালীন ভারতবর্ষের রাজনৈতিক, সামাজিক এবং অর্থনৈতিক কাঠামোতে বাবরের আগমন এক যুগান্তকারী পরিবর্তন সূচিত করেছিল।'
        : 'এবং এই ধারার বিকাশ সম্রাট জাহাঙ্গীর ও শাহজাহানের শাসনামলে চরম উৎকর্ষে পৌঁছায়। ঐতিহাসিকদের মতে, আগ্রা ও দিল্লির স্থাপত্যে এর সুস্পষ্ট প্রভাব লক্ষ্য করা যায়।';
    const bodyEnd =
      i % 2 === 1
        ? 'সম্রাট আকবরের আমলে রাজস্ব ব্যবস্থার আমূল সংস্কার সাধিত হয় এবং চিত্র ও স্থাপত্যশিল্পে এক নতুন ধারার সূচনা ঘটে যা পরবর্তীকালে মুঘল রীতি নামে পরিচিতি লাভ করে'
        : 'কিংবা বলা যায়, মধ্যযুগের ইতিহাসে এই অধ্যায়টি অত্যন্ত তাৎপর্যপূর্ণ এবং পরবর্তী শাসকদের জন্য এক স্থায়ী আদর্শ হিসেবে প্রতিষ্ঠিত হয়েছিল।';
    pages.push({
      id: `p-${i}`,
      pageNumber: i,
      imageUrl: '',
      status: 'completed',
      markdown: `${chapHeading}মুঘল সাম্রাজ্যের ইতিহাস\n\n${bodyStart}${figBlock}${bodyEnd}\n\n${i}`,
      figures: hasFig
        ? [
            {
              caption: 'চিত্র',
              type: 'illustration',
              imageUrl: samplePng,
              dataUrl: samplePng,
              top: 20,
              left: 10,
              width: 80,
              height: 30,
              align: 'center',
            },
          ]
        : [],
    });
  }
  return pages;
}

async function runTests() {
  console.log('Running Image Caption & Performance Regression Suite (TEST 1 - TEST 7)...\n');

  // =========================================================================
  // TEST 1 — Image with automatically generated placeholder "চিত্র"
  // =========================================================================
  {
    const figWithPlaceholder: PageFigure = {
      caption: 'চিত্র',
      type: 'illustration',
      imageUrl: samplePng,
      dataUrl: samplePng,
      top: 20,
      left: 10,
      width: 80,
      height: 30,
      align: 'center',
    };

    const pages: PageItem[] = [
      {
        id: 't1-p1',
        pageNumber: 1,
        imageUrl: '',
        status: 'completed',
        markdown:
          '# প্রথম অধ্যায়\n\nপ্রথম অনুচ্ছেদের টেক্সট।\n\n[IMAGE_FIGURE: {"type":"illustration","box_2d":[200,100,500,800]}]\nচিত্র\n\nদ্বিতীয় অনুচ্ছেদের টেক্সট।',
        figures: [figWithPlaceholder],
      },
    ];

    const res = await generateEpubBlob(defaultBook, pages);
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer());
    const xhtml = await zip.file('OEBPS/page_1.xhtml')!.async('string');

    assert.equal(isGenericFigurePlaceholderCaption('চিত্র'), true);
    assert.equal(isGenericFigurePlaceholderCaption('*চিত্র*'), true);
    assert.equal(isGenericFigurePlaceholderCaption('[চিত্র]'), true);

    assert.ok(xhtml.includes('<img src="figures/page_1_fig_1.png"'), 'Image tag must be present');
    assert.ok(!xhtml.includes('<figcaption'), 'No <figcaption> should be generated for generic placeholder "চিত্র"');
    assert.ok(!xhtml.includes('>চিত্র<'), 'The word "চিত্র" must not appear as visible text under the image');

    console.log('PASS: TEST 1 — Automatically generated placeholder "চিত্র" is completely absent under images.');
  }

  // =========================================================================
  // TEST 2 — Image with real caption from the PDF ("চিত্র ১: মুঘল স্থাপত্য")
  // =========================================================================
  {
    const figWithRealCaption: PageFigure = {
      caption: '',
      type: 'illustration',
      imageUrl: samplePng,
      dataUrl: samplePng,
      top: 20,
      left: 10,
      width: 80,
      height: 30,
      align: 'center',
    };

    const pages: PageItem[] = [
      {
        id: 't2-p1',
        pageNumber: 1,
        imageUrl: '',
        status: 'completed',
        markdown:
          '# স্থাপত্য শিল্প\n\nমুঘল আমলের স্থাপত্য নিদর্শন।\n\n[IMAGE_FIGURE: {"type":"illustration","box_2d":[200,100,500,800]}]\nচিত্র ১: মুঘল স্থাপত্য\n\nপরবর্তী অনুচ্ছেদের আলোচনা।',
        figures: [figWithRealCaption],
      },
    ];

    const res = await generateEpubBlob(defaultBook, pages);
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer());
    const xhtml = await zip.file('OEBPS/page_1.xhtml')!.async('string');

    assert.equal(isGenericFigurePlaceholderCaption('চিত্র ১: মুঘল স্থাপত্য'), false);
    assert.ok(
      xhtml.includes('<figcaption class="figure-caption">চিত্র ১: মুঘল স্থাপত্য</figcaption>'),
      'Genuine caption "চিত্র ১: মুঘল স্থাপত্য" must remain intact inside <figcaption>'
    );

    console.log('PASS: TEST 2 — Genuine caption "চিত্র ১: মুঘল স্থাপত্য" is preserved intact.');
  }

  // =========================================================================
  // TEST 3 — Image without caption (no blank caption container or extra vertical space)
  // =========================================================================
  {
    const figWithoutCaption: PageFigure = {
      caption: '',
      type: 'illustration',
      imageUrl: samplePng,
      dataUrl: samplePng,
      top: 20,
      left: 10,
      width: 80,
      height: 30,
      align: 'center',
    };

    const xhtml = markdownToXhtml(
      'উপরের অনুচ্ছেদ।\n\n[IMAGE_FIGURE: {"type":"illustration","box_2d":[200,100,500,800]}]\n\nনিচের অনুচ্ছেদ।',
      [figWithoutCaption],
      { isPreview: false, pageNumber: 1 }
    );

    assert.ok(xhtml.includes('<figure class="book-figure fig-center text-center my-4">'), 'Figure wrapper retained');
    assert.ok(xhtml.includes('<img src="figures/page_1_fig_1.png" alt=""'), 'Image retained with empty alt');
    assert.ok(!xhtml.includes('<figcaption'), 'No empty <figcaption> container rendered');
    assert.ok(!xhtml.includes('চিত্র'), 'No "চিত্র" label rendered anywhere');

    console.log('PASS: TEST 3 — Image without caption renders cleanly with no "চিত্র" label or empty <figcaption>.');
  }

  // =========================================================================
  // TEST 4 — Body text containing the word "চিত্র" in ordinary prose
  // =========================================================================
  {
    const proseParagraph =
      'এই গ্রন্থে তৎকালীন সমাজজীবনের একটি নিখুঁত চিত্র ফুটে উঠেছে এবং প্রতিটি চরিত্রের মনস্তাত্ত্বিক চিত্র অত্যন্ত দক্ষতার সাথে অঙ্কিত হয়েছে।';
    const xhtml = markdownToXhtml(proseParagraph, [], { isPreview: false, pageNumber: 1 });

    assert.ok(
      xhtml.includes(proseParagraph),
      'Ordinary prose containing the word "চিত্র" must remain completely unchanged'
    );

    console.log('PASS: TEST 4 — Body prose containing the word "চিত্র" remains completely unchanged.');
  }

  // =========================================================================
  // TEST 5 — Image between paragraphs (placement, paragraph order, and spacing)
  // =========================================================================
  {
    const figBetween: PageFigure = {
      caption: 'চিত্র',
      type: 'illustration',
      imageUrl: samplePng,
      dataUrl: samplePng,
      top: 35,
      left: 15,
      width: 70,
      height: 25,
      align: 'center',
    };

    const pages: PageItem[] = [
      {
        id: 't5-p1',
        pageNumber: 1,
        imageUrl: '',
        status: 'completed',
        markdown:
          '# প্রথম অধ্যায়\n\nপ্রথম অনুচ্ছেদ: বাবরের প্রাথমিক জীবন ও সংগ্রাম।\n\n[IMAGE_FIGURE: {"type":"illustration","box_2d":[350,150,600,850]}]\n\nদ্বিতীয় অনুচ্ছেদ: পানিপথের প্রথম যুদ্ধের ঘটনাপ্রবাহ।',
        figures: [figBetween],
      },
    ];

    const res = await generateEpubBlob(defaultBook, pages);
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer());
    const xhtml = await zip.file('OEBPS/page_1.xhtml')!.async('string');

    const p1Idx = xhtml.indexOf('প্রথম অনুচ্ছেদ: বাবরের প্রাথমিক জীবন ও সংগ্রাম।');
    const imgIdx = xhtml.indexOf('<img src="figures/page_1_fig_1.png"');
    const p2Idx = xhtml.indexOf('দ্বিতীয় অনুচ্ছেদ: পানিপথের প্রথম যুদ্ধের ঘটনাপ্রবাহ।');

    assert.ok(p1Idx > 0 && imgIdx > p1Idx && p2Idx > imgIdx, 'Image must remain strictly between paragraph 1 and paragraph 2');
    assert.ok(zip.file('OEBPS/figures/page_1_fig_1.png'), 'Binary image file must be packaged in OEBPS/figures/');

    console.log('PASS: TEST 5 — Image placement, binary packaging, and paragraph ordering remain intact.');
  }

  // =========================================================================
  // TEST 6 & TEST 7 — Performance Benchmark & Output Correctness Verification
  // =========================================================================
  {
    const pages = buildRepresentativeBook(40);
    // Warmup run
    const warmupRes = await generateEpubBlob(defaultBook, pages);
    assert.ok(warmupRes.validationReport?.isValid, 'EPUB package validation must pass');

    const runs = 5;
    let totalMs = 0;
    let sanitizeMs = 0;
    let tocMs = 0;
    let layoutMs = 0;
    let xhtmlMs = 0;

    for (let r = 0; r < runs; r++) {
      const s0 = performance.now();
      const sanitized = sanitizePagesForExport(pages, defaultBook);
      sanitizeMs += performance.now() - s0;

      const tc0 = performance.now();
      const tocRes = extractAuthoritativeTocTree(sanitized, { bookDetails: defaultBook });
      tocMs += performance.now() - tc0;

      const l0 = performance.now();
      const layoutRes = reconstructDocumentLayoutForEpub(sanitized, {
        bookDetails: defaultBook,
        tocTree: tocRes.tree,
        identifiedTocPageNums: new Set(tocRes.tocPages),
        smartSpacing: true,
      });
      layoutMs += performance.now() - l0;

      const x0 = performance.now();
      for (const grp of layoutRes.consolidatedGroups) {
        markdownToXhtml(grp.sectionPage.markdown, grp.sectionPage.figures, {
          isPreview: false,
          pageNumber: grp.sectionPage.pageNumber,
          allPages: sanitized,
        });
      }
      xhtmlMs += performance.now() - x0;

      const e0 = performance.now();
      await generateEpubBlob(defaultBook, pages);
      totalMs += performance.now() - e0;
    }

    const avgGenerateEpubBlobMs = +(totalMs / runs).toFixed(2);
    const avgSanitizeMs = +(sanitizeMs / runs).toFixed(2);
    const avgTocMs = +(tocMs / runs).toFixed(2);
    const avgLayoutMs = +(layoutMs / runs).toFixed(2);
    const avgXhtmlMs = +(xhtmlMs / runs).toFixed(2);

    console.log(
      'BENCHMARK_METRICS:',
      JSON.stringify({
        avgGenerateEpubBlobMs,
        avgSanitizeMs,
        avgTocMs,
        avgLayoutMs,
        avgXhtmlMs,
      })
    );

    // Verify TEST 7: Output accuracy, navigation entries, cross-page merges, and images
    const zip = await JSZip.loadAsync(await warmupRes.blob.arrayBuffer());
    const navXhtml = await zip.file('OEBPS/nav.xhtml')!.async('string');
    assert.ok(navXhtml.includes('অধ্যায় ১: বাবরের ভারত অভিযান'), 'Chapter 1 in nav.xhtml');
    assert.ok(navXhtml.includes('অধ্যায় ২: হুমায়ুনের শাসনকাল'), 'Chapter 2 in nav.xhtml');
    assert.ok(navXhtml.includes('অধ্যায় ৩: আকবরের সংস্কার ও প্রশাসন'), 'Chapter 3 in nav.xhtml');
    assert.ok(navXhtml.includes('অধ্যায় ৪: স্থাপত্য ও চিত্রকলা'), 'Chapter 4 in nav.xhtml');

    const chap1Xhtml = await zip.file('OEBPS/page_3.xhtml')!.async('string');
    assert.ok(
      chap1Xhtml.includes(
        'মুঘল রীতি নামে পরিচিতি লাভ করে এবং এই ধারার বিকাশ সম্রাট জাহাঙ্গীর ও শাহজাহানের শাসনামলে চরম উৎকর্ষে পৌঁছায়।'
      ),
      'Cross-page continuation paragraphs must be seamlessly merged'
    );
    assert.ok(!chap1Xhtml.includes('<figcaption'), 'No unwanted "চিত্র" captions in consolidated chapter XHTML');

    console.log('PASS: TEST 6 & TEST 7 — Performance benchmark completed and output accuracy verified.');
  }
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
