export function normalizeSiteSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 63)
    .replace(/^-+|-+$/g, "");
}
export function siteChoice(slug: string, phone: string) {
  const whatsappNumber = phone.trim().replace(/[\s()+-]/g, "");
  const label = normalizeSiteSlug(slug);
  return label && /^\d{8,15}$/.test(whatsappNumber)
    ? { slug: label, whatsappNumber }
    : undefined;
}
