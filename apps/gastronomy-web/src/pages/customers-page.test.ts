import { describe, expect, it } from "vitest";
import type { CustomerDto } from "@gastronomy/contracts";
import {
  addressDisplayLabel,
  customerResultRange,
  filterCustomersForQuery,
  findPotentialCustomerDuplicates,
  validateAddressRows,
} from "./customers-page";

const customers: CustomerDto[] = [
  {
    id: "customer-1",
    name: "Ana Rodríguez",
    phone: "11 4444-9080",
    notes: null,
    preferences: null,
    tags: [],
    preferredPaymentMethodCode: null,
    active: true,
    mergedIntoCustomerId: null,
    updatedAt: "2026-09-01T12:00:00.000Z",
    addresses: [
      {
        id: "address-1",
        label: "Casa",
        address: "Av. Rivadavia 3250",
        notes: null,
        deliveryFeeMinor: 250_000,
      },
    ],
  },
];

describe("ficha de clientes", () => {
  it("calcula el rango visible de una página sin exceder el total", () => {
    expect(customerResultRange(1, 24, 53)).toEqual({ from: 1, to: 24 });
    expect(customerResultRange(3, 24, 53)).toEqual({ from: 49, to: 53 });
    expect(customerResultRange(1, 24, 0)).toEqual({ from: 0, to: 0 });
  });

  it("descarta resultados amplios del repositorio que no coinciden con la consulta", () => {
    expect(filterCustomersForQuery(customers, "Mariana")).toEqual([]);
    expect(filterCustomersForQuery(customers, "114444")).toEqual(customers);
  });

  it("muestra una única marca principal y conserva la etiqueta descriptiva", () => {
    expect(addressDisplayLabel("Casa", 0)).toBe("Principal · Casa");
    expect(addressDisplayLabel("Principal", 0)).toBe("Principal");
    expect(addressDisplayLabel("Principal", 1)).toBe("Alternativa 1");
  });

  it("detecta coincidencias sin convertir el teléfono compartido en bloqueo", () => {
    const matches = findPotentialCustomerDuplicates(customers, {
      name: "Otra persona",
      phone: "11-4444-9080",
      addresses: [{ address: "Otra dirección" }],
    });

    expect(matches).toEqual([
      {
        customerId: "customer-1",
        customerName: "Ana Rodríguez",
        reasons: ["mismo teléfono"],
      },
    ]);
  });

  it("ignora al cliente actual al editar su propia ficha", () => {
    expect(
      findPotentialCustomerDuplicates(customers, {
        customerId: "customer-1",
        name: "Ana Rodríguez",
        phone: "11 4444-9080",
        addresses: [{ address: "Av. Rivadavia 3250" }],
      }),
    ).toEqual([]);
  });

  it("rechaza filas parcialmente cargadas y direcciones repetidas", () => {
    const result = validateAddressRows([
      {
        key: "a",
        label: "Casa",
        address: "Mitre 100",
        notes: null,
        deliveryFee: "2500",
      },
      {
        key: "b",
        label: "Trabajo",
        address: "",
        notes: "Portón azul",
        deliveryFee: "0",
      },
      {
        key: "c",
        label: "Familiar",
        address: " mitre 100 ",
        notes: null,
        deliveryFee: "3000",
      },
    ]);

    expect(result.valid).toHaveLength(1);
    expect(result.issues).toEqual([
      {
        key: "b",
        message: "Completá la dirección o eliminá esta fila incompleta.",
      },
      {
        key: "c",
        message: "Esta dirección está repetida dentro de la ficha.",
      },
    ]);
  });

  it("permite mantener una fila vacía sin convertirla en dirección", () => {
    expect(
      validateAddressRows([
        {
          key: "empty",
          label: "Casa",
          address: "",
          notes: null,
          deliveryFee: "0",
        },
      ]),
    ).toEqual({ issues: [], valid: [] });
  });
});
