const TIME_ZONE = "America/Argentina/Buenos_Aires";

function formatPromisedAt(promisedAt) {
  const date = new Date(promisedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIME_ZONE,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { date: `${values.day}/${values.month}/${values.year}`, time: `${values.hour}:${values.minute}` };
}

function scheduledOrderBadge(order) {
  if (!order.promisedAt) return "";
  const promised = formatPromisedAt(order.promisedAt);
  if (!promised) return "";
  if (!order.scheduled) return `<p class="promised">ENTREGA ${promised.time}</p>`;
  return `<section class="scheduled-badge" aria-label="Pedido programado"><strong class="scheduled-heading">PEDIDO PROGRAMADO</strong><span class="scheduled-delivery">ENTREGA PROGRAMADA</span><strong class="scheduled-datetime"><span class="scheduled-date">${promised.date}</span><span class="scheduled-time">${promised.time}</span></strong></section>`;
}

module.exports = { formatPromisedAt, scheduledOrderBadge };
