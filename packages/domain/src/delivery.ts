import { nonNegativeMoney } from "./money";

export function driverRemuneration(
  fee: number,
  belongsToDriver: boolean,
  agreed?: number | null,
) {
  return nonNegativeMoney(
    agreed ?? (belongsToDriver ? fee : 0),
    "remuneración del repartidor",
  );
}

export function calculateDeliverySettlement(input: {
  restaurantAmountMinor: number;
  deliveryFeeMinor: number;
  paymentDestination: "DRIVER" | "BUSINESS";
  deliveryFeeBelongsToDriver?: boolean;
  driverRemunerationMinor?: number | null;
}) {
  const restaurant = nonNegativeMoney(
    input.restaurantAmountMinor,
    "venta del restaurante",
  );
  const fee = nonNegativeMoney(input.deliveryFeeMinor, "costo de delivery");
  const customerTotalMinor = restaurant + fee;
  const driverCollectedMinor =
    input.paymentDestination === "DRIVER" ? customerTotalMinor : 0;
  const pay = driverRemuneration(
    fee,
    input.deliveryFeeBelongsToDriver ?? true,
    input.driverRemunerationMinor,
  );
  return {
    customerTotalMinor,
    driverCollectedMinor,
    driverOwesBusinessMinor: Math.max(0, driverCollectedMinor - pay),
    businessOwesDriverMinor: Math.max(0, pay - driverCollectedMinor),
  };
}
