import { nonNegativeMoney } from "./money";

export function calculateDeliverySettlement(input: {
  restaurantAmountMinor: number;
  deliveryFeeMinor: number;
  paymentDestination: "DRIVER" | "BUSINESS";
}) {
  const restaurant = nonNegativeMoney(input.restaurantAmountMinor, "venta del restaurante");
  const fee = nonNegativeMoney(input.deliveryFeeMinor, "costo de delivery");
  return input.paymentDestination === "DRIVER"
    ? {
        customerTotalMinor: restaurant + fee,
        driverCollectedMinor: restaurant + fee,
        driverOwesBusinessMinor: restaurant,
        businessOwesDriverMinor: 0
      }
    : {
        customerTotalMinor: restaurant + fee,
        driverCollectedMinor: 0,
        driverOwesBusinessMinor: 0,
        businessOwesDriverMinor: fee
      };
}
