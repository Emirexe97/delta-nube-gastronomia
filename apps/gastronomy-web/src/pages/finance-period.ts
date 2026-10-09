export function fullMonthForRange(from: string, to: string): string {
  const match = /^(\d{4})-(\d{2})-01$/.exec(from);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1 || month < 1 || month > 12) return "";
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days =
    month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  const value = from.slice(0, 7);
  return to === `${value}-${days}` ? value : "";
}
