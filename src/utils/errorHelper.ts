/**
 * Utility for formatting and sanitizing error messages into clear, courteous Bengali text.
 * Prevents raw Google API JSON or developer stack traces from leaking to the user.
 */

export function formatFriendlyErrorMessage(err: any): string {
  if (!err) {
    return 'একটি অপ্রত্যাশিত ত্রুটি ঘটেছে। অনুগ্রহ করে আবার চেষ্টা করুন।';
  }

  const rawMessage = typeof err === 'string'
    ? err
    : (err?.message || (err?.error ? (typeof err.error === 'string' ? err.error : JSON.stringify(err.error)) : JSON.stringify(err)));

  // Check for 429 Quota Exceeded / Rate Limit
  if (
    rawMessage.includes('429') ||
    rawMessage.includes('RESOURCE_EXHAUSTED') ||
    rawMessage.includes('quota') ||
    rawMessage.includes('Quota') ||
    rawMessage.includes('rate-limits') ||
    rawMessage.includes('rate limit') ||
    rawMessage.includes('Free Tier')
  ) {
    return 'গুগল এআই কোটা সীমা (429 Rate Limit): ফ্রি টিয়ারে প্রতি মিনিটে রিকোয়েস্ট সীমা সাময়িকভাবে পূর্ণ হয়েছে। কয়েক সেকেন্ড পর "রিস্ক্যান" বাটনে চাপুন।';
  }

  // Check for 503 Service Unavailable / Overloaded
  if (rawMessage.includes('503') || rawMessage.includes('UNAVAILABLE') || rawMessage.includes('overloaded')) {
    return 'গুগল এআই সার্ভার সাময়িকভাবে ব্যস্ত। অনুগ্রহ করে কয়েক সেকেন্ড অপেক্ষা করে আবার রিস্ক্যান করুন।';
  }

  // Check for network connection issues
  if (rawMessage.includes('Failed to fetch') || rawMessage.includes('NetworkError') || rawMessage.includes('ECONNREFUSED')) {
    return 'নেটওয়ার্ক সংযোগে সমস্যা হয়েছে। ইন্টারনেট সংযোগ পরীক্ষা করে পুনরায় চেষ্টা করুন।';
  }

  // If the message contains raw JSON string, try to parse or strip it
  if (rawMessage.includes('{') && rawMessage.includes('}')) {
    try {
      const match = rawMessage.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed?.error?.message) {
          return formatFriendlyErrorMessage(parsed.error.message);
        }
      }
    } catch (e) {
      // ignore json parse error and fallback
    }
    return 'এআই ভিশন প্রসেসিংয়ের সময় সাময়িক ত্রুটি হয়েছে। অনুগ্রহ করে রিস্ক্যান বাটনে ক্লিক করুন।';
  }

  // If message is clean and short, return it; otherwise return a helpful Bengali fallback
  if (rawMessage.length > 0 && rawMessage.length < 120 && !rawMessage.includes('http') && !rawMessage.includes('at ')) {
    return rawMessage;
  }

  return 'পৃষ্ঠাটি পাঠোদ্ধার করার সময় সমস্যা হয়েছে। অনুগ্রহ করে রিস্ক্যান বাটনে ক্লিক করুন।';
}
