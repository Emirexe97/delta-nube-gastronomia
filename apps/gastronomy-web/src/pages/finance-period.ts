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

export function previousPeriodRange(from: string, to: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start || start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to) return null;
  const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
  const [year, month, day] = from.split("-").map(Number);
  const [endYear, endMonth, endDay] = to.split("-").map(Number);
  if (fullMonthForRange(from, to)) {
    const priorMonth = new Date(Date.UTC(year!, month! - 2, 1));
    const priorYear = priorMonth.getUTCFullYear();
    const priorMonthNumber = priorMonth.getUTCMonth() + 1;
    return {
      from: `${priorYear}-${String(priorMonthNumber).padStart(2, "0")}-01`,
      to: `${priorYear}-${String(priorMonthNumber).padStart(2, "0")}-${daysInMonth(priorYear, priorMonthNumber)}`,
    };
  }
  if (day === 1 && year === endYear && month === endMonth) {
    const priorMonth = new Date(Date.UTC(year!, month! - 2, 1));
    const priorYear = priorMonth.getUTCFullYear();
    const priorMonthNumber = priorMonth.getUTCMonth() + 1;
    const clippedEnd = Math.min(endDay!, daysInMonth(priorYear, priorMonthNumber));
    return {
      from: `${priorYear}-${String(priorMonthNumber).padStart(2, "0")}-01`,
      to: `${priorYear}-${String(priorMonthNumber).padStart(2, "0")}-${String(clippedEnd).padStart(2, "0")}`,
    };
  }
  const duration = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const priorEnd = new Date(start.getTime() - 86_400_000);
  const priorStart = new Date(priorEnd.getTime() - (duration - 1) * 86_400_000);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { from: iso(priorStart), to: iso(priorEnd) };
}
