/**
 * Helper utility for formatting scanning duration and elapsed time
 */

export const formatElapsedTime = (totalSeconds: number): string => {
  if (!totalSeconds || totalSeconds < 0) return '00:00';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
};

export const formatBengaliDuration = (totalSeconds: number): string => {
  if (!totalSeconds || totalSeconds <= 0) return '০ সেকেন্ড';

  const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  const toBn = (n: number) =>
    n
      .toString()
      .split('')
      .map((d) => bengaliDigits[parseInt(d, 10)] ?? d)
      .join('');

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${toBn(hours)} ঘণ্টা`);
  if (minutes > 0) parts.push(`${toBn(minutes)} মি.`);
  if (seconds > 0 || parts.length === 0) parts.push(`${toBn(seconds)} সে.`);

  return parts.join(' ');
};
