# বাংলা ইপাব স্টুডিও (Bangla EPUB Studio) 📚

**Bangla EPUB Studio** is a production-grade, end-to-end **Bengali & Multilingual PDF-to-EPUB 3 Conversion Studio**. It transforms scanned or digital PDF books into clean, reflowable, publication-ready **EPUB 3** (with backward-compatible **EPUB 2 NCX**) eBooks optimized for Kindle, Apple Books, Kobo, Google Play Books, Moon+ Reader, CrossInk, and Calibre.

---

## ✨ Key Features

### 1. 🔍 High-Precision Bengali & Mixed-Script OCR Pipeline
- **Strict Bengali Unicode Enforcement (`U+0980–U+09FF`)**: Prevents cross-Indic and Latin homoglyph contamination inside Bengali words (for example, automatically detecting and repairing Telugu/Devanagari/Tamil/Odia glyph intrusions such as `కిংবা` → `কিংবা`) without altering legitimate English words, mathematical symbols, numbers, Sanskrit shlokas, or Arabic quotations.
- **Orthographic & Conjunct Preservation**: Accurately preserves complex Bengali conjuncts (*যুক্তাক্ষর* — `ক্ষ`, `জ্ঞ`, `ষ্ণ`, `ণ্ড`, `হ্ণ`, `ঙ্ক`, `ঙ্গ`, `ঙ্ঘ`, `দ্ধ`, `ত্ত্ব`), vowel signs (*কার*), *চন্দ্রবিন্দু* (`ঁ`), *অনুস্বার* (`ং`), *বিসর্গ* (`ঃ`), *হসন্ত* (`্`), and *দাঁড়ি* (`।`), as well as both *সাধু* and *চলিত* literary styles.
- **Multi-Stage Validation & Selective Visual Verification**:
  1. **Unicode Script & Sequence Normalization**: Fixes broken vowel sign ordering and duplicate diacritics.
  2. **Context-Aware Lexical & Grammatical Correction**: Evaluates suspicious tokens in sentence context before applying high-confidence repairs.
  3. **Selective Image-Based Glyph Verification**: Re-verifies ambiguous low-confidence tokens against the original page scan before modifying text.

### 2. 🧩 Intelligent EPUB Layout Reconstruction & Gap Removal
- **Page-Boundary Continuity**: Automatically detects and merges paragraphs split across PDF page boundaries using a multi-signal confidence scoring engine (`high`, `medium`, `low`, `none`) based on terminal punctuation, trailing conjunctions/postpositions, hyphenated line-end words, and indentation.
- **Chapter-Safe Section Consolidation**: Consolidates non-chapter continuation pages into their parent chapter spine section so PDF page breaks do not create artificial breaks in reflowable e-readers, while strictly preserving intentional chapter starts (`# `, `## `, TOC targets) and remapping internal anchors (`#page_N`, `#toc-h-pN-...`).
- **Multi-Column Reading Order Reconstruction**: Detects 2-column and 3-column layouts from 2D PDF geometry coordinates, side-by-side text gutters, or HTML column containers, linearizing Column 1 top-to-bottom before Column 2 top-to-bottom while keeping full-width spanning titles, figures, tables, and footnotes in proper sequence.
- **Running Header, Footer & Page-Number Removal**: Frequency-based and pattern-based stripping of repeated running headers, footers, printed page numbers, printer signature marks (*ফর্মা নম্বর*), and scanner watermarks.
- **HTML & CSS Normalization**: Strips empty `<p>`/`<div>`/`<span>` tags, collapses repeated `<br />` sequences, removes fixed pixel heights and `position: absolute` styles, wraps Markdown tables in semantic `<table class="epub-table">`, and pairs illustrations with `<figcaption class="figure-caption">`.

### 3. 📑 Authoritative Table of Contents (TOC) Extraction
- **Multi-Source Priority Engine**:
  1. **PDF Native Outline / Bookmarks** (when embedded in the PDF).
  2. **Printed Table of Contents Pages (`সূচিপত্র`)**: Supports single-page and multi-page TOCs, dot leaders, em-dashes, Bengali and English numerals, and up to 4 hierarchical levels (Part → Chapter → Section → Sub-section).
  3. **Verified Body Headings Fallback**: Activated only when no printed TOC or PDF outline exists, preventing body subheadings or bold sentences from polluting the book's original TOC.
- **Single Unified TOC in EPUB**: Generates `nav.xhtml` (EPUB 3), `toc.ncx` (EPUB 2), and a single clean visual `toc.xhtml` while preventing duplicate raw TOC pages from appearing in the reading spine.

### 4. 🖼️ Lossless Figure & Illustration Extraction
- **Smart Mode / Text-Only / Image-Preserving Modes**:
  - Automatically detects whether a PDF page contains embedded raster illustrations beyond the background scan sheet.
  - Crops figures at full native resolution using 2D affine transformation matrices (`CTM`) and bounding-box coordinates (`box_2d`) without arbitrary downscaling.
  - Preserves original horizontal alignment (`left`, `center`, `right`) and bundles images with accurate MIME types (`image/png` / `image/jpeg`) in the EPUB manifest.

### 5. ⚡ Multi-Key Pool & High-Throughput Batch Engine
- **Smart Key Pool Manager**: Supports multiple API keys with automatic token-bucket rate pacing, rolling 60-second RPM tracking, automatic failover across keys, and resilient model fallback.
- **Configurable Batch Concurrency**: Process 1 to 5 pages concurrently with live page tracking, pause/resume controls, per-page rescan, and custom prompt segments.

### 6. 🖥️ Interactive 3-Pane Studio & Live E-Reader Simulator
- **Left Sidebar**: Page thumbnails, search & filter (`All`, `Completed`, `Pending`, `Skipped`), status badges (`Text`, `TOC`, `Figure`), and one-click page skip/delete.
- **Center PDF Viewport**: High-resolution PDF page preview with zoom, pan, continuous scroll mode, and single-page OCR trigger.
- **Right Markdown & Validation Editor**: Live Markdown editor, formatting toolbar, OCR script validation diagnostics badge, and conversion monitor.
- **Export & E-Reader Preview Modal**: Customize book metadata (Title, Author, Publisher, Year, ISBN, Language, Cover image), preview the rendered book in Light/Sepia/Dark themes with Bengali typography options (*Noto Sans Bengali*, *Kalpurush*, *SolaimanLipi*, *Hind Siliguri*), and export to `.epub` or `.md`.

---

## 🏗️ Project Architecture

```text
├── server.ts                          # Express backend, KeyPoolManager, & OCR/Verification API routes
├── src/
│   ├── App.tsx                        # Main studio state, batch conversion queue, & responsive workspace
│   ├── types/
│   │   └── index.ts                   # Shared TypeScript interfaces for pages, OCR, TOC, & layout reports
│   ├── components/
│   │   ├── Header.tsx                 # Responsive studio header & navigation controls
│   │   ├── FileUploadStep.tsx         # PDF upload & 1-click sample Bengali book loader ("রক্তকরবী")
│   │   ├── PageListSidebar.tsx        # Left pane: page list, status filters, & quick actions
│   │   ├── CenterProcessPanel.tsx     # Center pane: PDF canvas viewer, zoom, & OCR controls
│   │   ├── RightEditorPanel.tsx       # Right pane: Markdown editor & live conversion logs
│   │   ├── FinalExportModal.tsx       # EPUB 3 metadata, cover selector, e-reader simulator, & export
│   │   ├── KeyPoolModal.tsx           # Multi-key pool management & RPM capacity monitor
│   │   ├── ModelSettingsModal.tsx     # OCR model, batch size, watermark filter, & figure mode settings
│   │   └── PromptSegmentsModal.tsx    # Book structure & TOC page configuration modal
│   └── utils/
│       ├── bengaliOcrPipeline.ts      # Bengali Unicode script enforcement & context-aware OCR repair
│       ├── epubLayoutPipeline.ts      # Multi-column ordering, cross-page paragraph merging, & HTML/CSS cleanup
│       ├── epubGenerator.ts           # EPUB 3 / NCX packager, XHTML converter, & CSS generator
│       ├── tocExtractor.ts            # Multi-source hierarchical TOC extraction engine
│       ├── xhtmlValidator.ts          # Strict XML/XHTML parser, auto-healer, & EPUB package validator
│       ├── imageExtractor.ts          # PDF operator-list figure detector & lossless regional cropper
│       ├── pdfRenderer.ts             # PDF.js document loader, canvas renderer, & 2D layout block extractor
│       └── samplePdf.ts               # Built-in sample Bengali book ("রক্তকরবী" — রবীন্দ্রনাথ ঠাকুর)
└── tests/
    ├── epubLayoutReconstruction.test.ts # Tests for layout cleanup, multi-column, & cross-page merging
    ├── bengaliOcrValidation.test.ts     # Regression tests for mixed-script & Bengali conjunct accuracy
    ├── epubValidationRegression.test.ts # XHTML well-formedness & CrossInk compatibility tests
    ├── tocExtraction.test.ts            # 12-scenario TOC extraction & navigation verification suite
    └── imageExtraction.test.ts          # 10-scenario PDF CTM matrix & figure extraction test suite
