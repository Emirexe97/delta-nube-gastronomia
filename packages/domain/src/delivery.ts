import { nonNegativeMoney } from "./money";

export function calculateDeliverySettlement(input: {
  restaurantAmountMinor: number;
  deliveryFeeMinor: number;
  paymentDestination: "DRIVER" | "BUSINESS";
  deliveryFeeBelongsToDriver?: boolean;
}) {
  const restaurant = nonNegativeMoney(
    input.restaurantAmountMinor,
    "venta del restaurante",
  );
  const fee = nonNegativeMoney(input.deliveryFeeMinor, "costo de delivery");
  const feeBelongsToDriver = input.deliveryFeeBelongsToDriver ?? true;
  if (!feeBelongsToDriver) {
    return input.paymentDestination === "DRIVER"
      ? {
          customerTotalMinor: restaurant + fee,
          driverCollectedMinor: restaurant + fee,
          driverOwesBusinessMinor: restaurant + fee,
          businessOwesDriverMinor: 0,
        }
      : {
          customerTotalMinor: restaurant + fee,
          driverCollectedMinor: 0,
          driverOwesBusinessMinor: 0,
          businessOwesDriverMinor: 0,
        };
  }
  return input.paymentDestination === "DRIVER"
    ? {
        customerTotalMinor: restaurant + fee,
        driverCollectedMinor: restaurant + fee,
        driverOwesBusinessMinor: restaurant,
        businessOwesDriverMinor: 0,
      }
    : {
        customerTotalMinor: restaurant + fee,
        driverCollectedMinor: 0,
        driverOwesBusinessMinor: 0,
        businessOwesDriverMinor: fee,
      };
}
