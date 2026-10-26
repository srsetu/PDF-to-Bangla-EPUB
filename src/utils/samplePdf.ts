/**
 * Sample Bengali Book Generator for instant testing without needing an external PDF file
 */

export interface SamplePageData {
  pageNumber: number;
  title: string;
  lines: string[];
  isCover?: boolean;
  hasIllustration?: boolean;
  watermark?: string;
}

export const SAMPLE_BOOK_META = {
  title: 'রক্তকরবী (বিশেষ সংস্করণ)',
  author: 'রবীন্দ্রনাথ ঠাকুর',
  publisher: 'বিশ্বভারতী গ্রন্থনবিভাগ',
  genre: 'নাটক ও কাব্যসাহিত্য',
  publishYear: '১৯২৪',
  description: 'যক্ষপুরীর স্বর্ণখনির পটভূমিতে মানবিক মুক্তির চিরায়ত রূপক নাটক।',
};

export const SAMPLE_PAGES: SamplePageData[] = [
  {
    pageNumber: 1,
    title: 'প্রচ্ছদ ও প্রারম্ভিক',
    isCover: true,
    lines: [
      'রক্তকরবী',
      'রবীন্দ্রনাথ ঠাকুর',
      'বিশ্বভারতী প্রকাশনী',
      'কলকাতা ও ঢাকা',
      'প্রথম প্রকাশ: পৌষ ১৩৩১',
    ],
    watermark: 'www.amarboi.com - scanned copy',
  },
  {
    pageNumber: 2,
    title: 'সূচীপত্র (Table of Contents)',
    lines: [
      'সূচীপত্র',
      '--------------',
      '১. যক্ষপুরীর স্বর্ণখনি ও নন্দিনী .............. পৃষ্ঠা ৩',
      '২. অধ্যাপক ও রঞ্জন ........................ পৃষ্ঠা ৪',
      '৩. বিশু পাগলের গান ....................... পৃষ্ঠা ৫',
      '৪. রাজার বাতায়ন ও রক্তকরবীর মঞ্জরী ......... পৃষ্ঠা ৬',
      '',
      'বিশেষ বিজ্ঞপ্তি: এই নাটকের পাঠান্তর ও শব্দকোষ পরিশিষ্টে দ্রষ্টব্য।',
    ],
    watermark: 'Scan by CamScanner Free',
  },
  {
    pageNumber: 3,
    title: 'প্রথম দৃশ্য: যক্ষপুরী',
    hasIllustration: true,
    lines: [
      '# প্রথম দৃশ্য: নন্দিনী ও অধ্যাপক',
      '',
      'অধ্যাপক: নন্দিনী, ও নন্দিনী! আজ তোমার রক্তকরবীর গুচ্ছ কোথায় পেলে?',
      '',
      'নন্দিনী: কোথা থেকে পাই সে কথা তোমাকে বলব না। যেখান থেকেই আনি, এ আমার রক্তের রঙে রাঙানো। এখানে সবাই মাটির নিচের অন্ধকার খুঁড়ে তাল তাল সোনা তুলতে ব্যস্ত, কেবল আমি মাটির ওপরের এই রক্তকরবীর ডালে প্রাণের সুর খুঁজে পাই।',
      '',
      'অধ্যাপক: যক্ষপুরীর পণ্ডিতরা বলে সোনাটাই চরম সত্য, আর প্রাণটা কেবল একটা ফাঁকিবাজি। কিন্তু তোমাকে দেখলে মনে হয় ওই ব্যাকরণের নিয়মটা হয়তো ভুল।',
      '',
      'নন্দিনী: তোমরা বিদ্যের জাল বুনে মানুষকে বন্দি করতে চাও। কিন্তু জাল ছিঁড়ে যেদিন পাখি উড়াল দেবে, সেদিন তোমরা কী করবে?',
    ],
    watermark: 'www.amarboi.com - scanned copy',
  },
  {
    pageNumber: 4,
    title: 'দ্বিতীয় দৃশ্য: বিশুর গান ও কবিতা',
    lines: [
      '## বিশু পাগলের গান',
      '',
      '<p class="text-center">* * *</p>',
      '<p class="text-center">"তোমায় নতুন করে পাব বলে</p>',
      '<p class="text-center">হারাই ক্ষণে ক্ষণ,</p>',
      '<p class="text-center">ও মোর ভালোবাসার ধন।</p>',
      '<p class="text-center">দেখা দেবে বলে তুমি</p>',
      '<p class="text-center">হও যে অদর্শন!"</p>',
      '<p class="text-center">* * *</p>',
      '',
      'নন্দিনী: বিশুভাই, তোমার গানের সুরে আমার বুক ভরে ওঠে। মনে হয় যক্ষপুরীর এই লৌহকবাট ভেঙে সব আলো এক নিমেষে ছড়িয়ে পড়েছে আকাশজুড়ে।',
      '',
      '<p class="indent-1">বিশু: নন্দিনী, অন্ধকার সুরঙ্গে যখন পাথরের ধুলোয় চোখ অন্ধ হয়ে আসে, তখন তোমার মুখখানা যেন ভোরের প্রথম তারার মতো মনে পড়ে।</p>',
      '',
      '<p class="text-right"><em>— রবীন্দ্রনাথ ঠাকুর (১৩৩১ বঙ্গাব্দ)</em></p>',
    ],
    watermark: 'Scan by CamScanner Free',
  },
  {
    pageNumber: 5,
    title: 'তৃতীয় দৃশ্য: রাজার বাতায়ন',
    hasIllustration: true,
    lines: [
      '### জালিকক্ষের অন্তরালে রাজা',
      '',
      'রাজা: নন্দিনী, তুমি বাইরে দাঁড়িয়ে আলো দেখছ, আর আমি এই জালের আড়ালে বসে মানুষের শক্তির হিসেব কষছি। তুমি আমাকে ভয় পাও না?',
      '',
      'নন্দিনী: ভয় আমি কাকে পাব? তুমি যে মানুষ, যন্ত্র নও। লোহার জালে নিজেকে ঢেকে রাখলেও তোমার হৃদয়ের স্পন্দন আমি বাইরে থেকেই শুনতে পাই।',
      '',
      'রাজা: আমার হাতে ক্লান্তি নেই, কিন্তু অন্তরে শান্তি নেই। তোমার ওই একগুচ্ছ রক্তকরবী আমাকে দেবে?',
      '',
      'নন্দিনী: এ যে রঞ্জনের জন্য গাঁথা মালা! এ আমি দেব না কাউকে, কেবল ভালোবাসার মুক্ত মানুষকে ছাড়া।',
      '',
      '---',
      '[^১]: যক্ষপুরীর রূপক অর্থে ঔপনিবেশিক শিল্পসভ্যতার যান্ত্রিক শোষণকে নির্দেশ করা হয়েছে।',
    ],
    watermark: 'www.amarboi.com - scanned copy',
  },
];

/**
 * Creates high resolution canvas image data URLs for sample pages
 */
export function renderSamplePageToCanvas(pageData: SamplePageData): Promise<string> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return resolve('');

    // Background paper texture style
    ctx.fillStyle = '#FCFBF7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Book border
    ctx.strokeStyle = '#E3DFD4';
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);

    // Watermark if any
    if (pageData.watermark) {
      ctx.save();
      ctx.font = '14px sans-serif';
      ctx.fillStyle = 'rgba(180, 50, 50, 0.4)';
      ctx.textAlign = 'center';
      ctx.fillText(pageData.watermark, canvas.width / 2, 22);
      ctx.fillText(pageData.watermark, canvas.width / 2, canvas.height - 15);
      ctx.restore();
    }

    if (pageData.isCover) {
      // Cover Page rendering
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, '#7F1D1D');
      grad.addColorStop(1, '#991B1B');
      ctx.fillStyle = grad;
      ctx.fillRect(50, 50, canvas.width - 100, canvas.height - 100);

      // Gold ornament border
      ctx.strokeStyle = '#FDE68A';
      ctx.lineWidth = 3;
      ctx.strokeRect(70, 70, canvas.width - 140, canvas.height - 140);

      // Flower motif (Red Oleander icon)
      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.arc(canvas.width / 2, 360, 50, 0, Math.PI * 2);
      ctx.fill();

      // Title
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 54px "Hind Siliguri", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('রক্তকরবী', canvas.width / 2, 490);

      // Subtitle
      ctx.font = '24px "Hind Siliguri", sans-serif';
      ctx.fillStyle = '#FDE68A';
      ctx.fillText('নাট্যকাব্য', canvas.width / 2, 535);

      // Author
      ctx.font = '32px "Hind Siliguri", sans-serif';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('রবীন্দ্রনাথ ঠাকুর', canvas.width / 2, 720);

      // Publisher
      ctx.font = '20px "Hind Siliguri", sans-serif';
      ctx.fillStyle = '#E5E7EB';
      ctx.fillText('বিশ্বভারতী গ্রন্থনবিভাগ', canvas.width / 2, 980);
      ctx.fillText('পৌষ ১৩৩১ বঙ্গাব্দ', canvas.width / 2, 1020);

      resolve(canvas.toDataURL('image/jpeg', 0.9));
      return;
    }

    // Interior pages
    // Header page number
    ctx.font = '16px "Hind Siliguri", sans-serif';
    ctx.fillStyle = '#6B7280';
    ctx.textAlign = 'right';
    ctx.fillText(`পৃষ্ঠা ${pageData.pageNumber}`, canvas.width - 60, 65);
    ctx.textAlign = 'left';
    ctx.fillText('রক্তকরবী — রবীন্দ্রনাথ ঠাকুর', 60, 65);

    // Decorative line
    ctx.strokeStyle = '#D1D5DB';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 75);
    ctx.lineTo(canvas.width - 60, 75);
    ctx.stroke();

    let currentY = 130;

    // Optional illustration placeholder
    if (pageData.hasIllustration) {
      const illWidth = canvas.width - 160;
      const illHeight = 220;
      const illX = 80;
      const illY = currentY;

      // Draw artistic frame
      ctx.fillStyle = '#F3E8FF';
      ctx.fillRect(illX, illY, illWidth, illHeight);
      ctx.strokeStyle = '#C084FC';
      ctx.lineWidth = 2;
      ctx.strokeRect(illX, illY, illWidth, illHeight);

      // Simple scenic graphic
      ctx.fillStyle = '#A855F7';
      ctx.beginPath();
      ctx.arc(illX + illWidth / 2, illY + 80, 35, 0, Math.PI * 2);
      ctx.fill();

      // Hill shapes
      ctx.fillStyle = '#9333EA';
      ctx.beginPath();
      ctx.moveTo(illX + 20, illY + illHeight);
      ctx.lineTo(illX + 180, illY + 110);
      ctx.lineTo(illX + 320, illY + illHeight);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(illX + 250, illY + illHeight);
      ctx.lineTo(illX + 450, illY + 130);
      ctx.lineTo(illX + illWidth - 20, illY + illHeight);
      ctx.fill();

      // Caption
      ctx.font = 'italic 16px "Hind Siliguri", sans-serif';
      ctx.fillStyle = '#6B21A8';
      ctx.textAlign = 'center';
      ctx.fillText('[ চিত্র: রক্তকরবী হাতে নন্দিনী ও যক্ষপুরীর প্রাচীর ]', canvas.width / 2, illY + illHeight - 15);

      currentY += illHeight + 40;
    }

    // Render body text
    pageData.lines.forEach((line) => {
      // Strip tags for canvas measure/drawing
      const isCenter = line.includes('text-center') || line.startsWith('<center>');
      const isRight = line.includes('text-right');
      const isIndent = line.includes('indent-1') || line.includes('indent-2') || line.startsWith('    ') || line.startsWith('  ');
      const cleanLine = line
        .replace(/<[^>]+>/g, '')
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .trim();

      if (line.startsWith('# ')) {
        ctx.font = 'bold 26px "Hind Siliguri", sans-serif';
        ctx.fillStyle = '#111827';
        ctx.textAlign = 'left';
        ctx.fillText(line.replace('# ', ''), 70, currentY);
        currentY += 40;
      } else if (line.startsWith('## ')) {
        ctx.font = 'bold 22px "Hind Siliguri", sans-serif';
        ctx.fillStyle = '#1F2937';
        ctx.textAlign = 'left';
        ctx.fillText(line.replace('## ', ''), 70, currentY);
        currentY += 34;
      } else if (line.startsWith('### ')) {
        ctx.font = 'bold 19px "Hind Siliguri", sans-serif';
        ctx.fillStyle = '#374151';
        ctx.textAlign = 'left';
        ctx.fillText(line.replace('### ', ''), 70, currentY);
        currentY += 30;
      } else if (line.startsWith('> ')) {
        ctx.font = 'italic 19px "Hind Siliguri", sans-serif';
        ctx.fillStyle = '#4B5563';
        ctx.textAlign = 'left';
        ctx.fillText(line.replace('> ', ''), 100, currentY);
        currentY += 28;
      } else if (line.startsWith('---')) {
        ctx.strokeStyle = '#9CA3AF';
        ctx.beginPath();
        ctx.moveTo(70, currentY);
        ctx.lineTo(250, currentY);
        ctx.stroke();
        currentY += 20;
      } else if (line === '') {
        currentY += 16;
      } else if (isCenter) {
        ctx.font = cleanLine === '* * *' ? 'bold 18px "Hind Siliguri", sans-serif' : 'italic 18px "Hind Siliguri", sans-serif';
        ctx.fillStyle = cleanLine === '* * *' ? '#4B5563' : '#374151';
        ctx.textAlign = 'center';
        ctx.fillText(cleanLine, canvas.width / 2, currentY);
        currentY += 28;
      } else if (isRight) {
        ctx.font = 'italic 17px "Hind Siliguri", sans-serif';
        ctx.fillStyle = '#4B5563';
        ctx.textAlign = 'right';
        ctx.fillText(cleanLine, canvas.width - 70, currentY);
        currentY += 28;
      } else {
        // Multi-line wrap
        ctx.font = '18px "Hind Siliguri", sans-serif';
        ctx.fillStyle = '#1F2937';
        ctx.textAlign = 'left';
        
        const startX = isIndent ? 110 : 70;
        const words = cleanLine.split(' ');
        let curLine = '';
        const maxWidth = canvas.width - 70 - startX;

        for (let i = 0; i < words.length; i++) {
          const testLine = curLine ? `${curLine} ${words[i]}` : words[i];
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth && i > 0) {
            ctx.fillText(curLine, startX, currentY);
            curLine = words[i];
            currentY += 28;
          } else {
            curLine = testLine;
          }
        }
        if (curLine) {
          ctx.fillText(curLine, startX, currentY);
          currentY += 30;
        }
      }
    });

    resolve(canvas.toDataURL('image/jpeg', 0.9));
  });
}
