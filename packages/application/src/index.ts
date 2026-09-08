import type {
  AddHalfAndHalfItemInput,
  AddOrderItemInput,
  AppSettingsDto,
  AuditEntryDto,
  BootstrapDto,
  BulkUpdateProductsInput,
  BusinessDate,
  CancelOrderInput,
  CashMovementInput,
  CashSessionDto,
  CategoryDto,
  CloseCashSessionInput,
  CreateOrderInput,
  CustomerSearchPageDto,
  CustomerDto,
  CustomerProfileDto,
  DashboardSummaryDto,
  DeliveryLedgerDto,
  DetailedReportDto,
  Id,
  OpenCashSessionInput,
  OrderDto,
  OrderOperationalStatus,
  PayOrderInput,
  ProductDto,
  RefundPaymentInput,
  ReportFilters,
  CashSessionHistoryItemDto,
  CashSessionReportDto,
  CashSessionReportFilters,
  SearchCustomersPageInput,
  UpdateProductInput,
  UpdateCustomerInput,
  UpdateDraftOrderInput,
  UpdateOrderItemNotesInput,
  ConfirmOrderInput,
  SettleDeliveryInput,
  TableSectorDto,
} from "@gastronomy/contracts";
import {
  assertMoneyMinor,
  assertAppSettings,
  assertOffPremiseCustomer,
  nonNegativeMoney,
} from "@gastronomy/domain";

type ChannelPrice = {
  priceListCode: "SALON" | "TAKEAWAY" | "DELIVERY";
  amountMinor: number;
};

function normalizeProductPrices(prices: ChannelPrice[]): ChannelPrice[] {
  const salon = prices.find((price) => price.priceListCode === "SALON");
  const offPremise =
    prices.find((price) => price.priceListCode === "TAKEAWAY") ??
    prices.find((price) => price.priceListCode === "DELIVERY");
  if (!salon || !offPremise)
    throw new Error("Completá los precios de Salón y Delivery / Para retirar.");
  return [
    { priceListCode: "SALON", amountMinor: salon.amountMinor },
    { priceListCode: "TAKEAWAY", amountMinor: offPremise.amountMinor },
    { priceListCode: "DELIVERY", amountMinor: offPremise.amountMinor },
  ];
}

export interface GastronomyRepository {
  bootstrap(): BootstrapDto;
  ensureTable(
    number: number,
  ): import("@gastronomy/contracts").RestaurantTableDto;
  openCashSession(input: OpenCashSessionInput): CashSessionDto;
  registerCashMovement(input: CashMovementInput): CashSessionDto;
  closeCashSession(input: CloseCashSessionInput): CashSessionDto;
  listCashSessionHistory(): CashSessionHistoryItemDto[];
  getCashSessionReport(filters: CashSessionReportFilters): CashSessionReportDto;
  createOrder(input: CreateOrderInput): OrderDto;
  updateDraftOrder(input: UpdateDraftOrderInput): OrderDto;
  confirmOrder(input: ConfirmOrderInput): OrderDto;
  discardDraftOrder(orderId: Id): { discarded: boolean };
  addOrderItem(input: AddOrderItemInput): OrderDto;
  updateOrderItemNotes(input: UpdateOrderItemNotesInput): OrderDto;
  addHalfAndHalfItem(input: AddHalfAndHalfItemInput): OrderDto;
  removeOrderItem(orderId: Id, itemId: Id): OrderDto;
  addOrderItemModifier(input: {
    orderId: Id;
    itemId: Id;
    modifierId: Id;
    scope: "FULL_PIZZA" | "FIRST_HALF" | "SECOND_HALF";
  }): OrderDto;
  removeOrderItemModifier(orderId: Id, modifierId: Id): OrderDto;
  applyOrderDiscount(input: {
    orderId: Id;
    mode: "PERCENTAGE" | "FIXED";
    value: number;
    reason: string;
    authorizerPin: string;
  }): OrderDto;
  updateOrderStatus(orderId: Id, status: OrderOperationalStatus): OrderDto;
  assignDeliveryDriver(input: {
    orderId: Id;
    driverUserId: Id | null;
  }): OrderDto;
  payOrder(input: PayOrderInput): OrderDto;
  refundPayment(input: RefundPaymentInput): OrderDto;
  completeOrder(input: PayOrderInput & { finalStatus: "DELIVERED" }): OrderDto;
  cancelOrder(input: CancelOrderInput): OrderDto;
  queuePrint(
    orderId: Id,
    kind: "KITCHEN_ORDER" | "CUSTOMER_BILL",
  ): { jobId: Id; status: string };
  preparePrintRetry(jobId: Id): {
    jobId: Id;
    orderId: Id;
    kind: "KITCHEN_ORDER" | "CUSTOMER_BILL";
    status: string;
  };
  markPrintJob(jobId: Id, status: "PRINTED" | "FAILED", error?: string): void;
  discardPrintJob(jobId: Id): void;
  searchCustomers(query: string): CustomerDto[];
  searchCustomersPage(input: SearchCustomersPageInput): CustomerSearchPageDto;
  getCustomerProfile(input: {
    customerId: Id;
    page: number;
    pageSize: number;
  }): CustomerProfileDto;
  createCustomer(input: {
    name: string;
    phone: string;
    notes?: string | null;
    preferences?: string | null;
    tags?: string[];
    preferredPaymentMethodCode?: string | null;
    address?: string | null;
    addresses?: UpdateCustomerInput["addresses"];
  }): CustomerDto;
  updateCustomer(input: UpdateCustomerInput): CustomerDto;
  setCustomerActive(input: {
    customerId: Id;
    active: boolean;
    reason: string;
    authorizerPin: string;
  }): CustomerDto;
  mergeCustomers(input: {
    sourceCustomerId: Id;
    targetCustomerId: Id;
    reason: string;
    authorizerPin: string;
  }): CustomerDto;
  createCategory(input: { name: string }): CategoryDto;
  updateCategory(input: {
    categoryId: Id;
    name: string;
    active: boolean;
    sortOrder: number;
    reason: string;
    authorizerPin: string;
  }): CategoryDto;
  deleteCategory(input: {
    categoryId: Id;
    reason: string;
    authorizerPin: string;
  }): { deleted: true };
  createProduct(input: {
    categoryId: Id;
    name: string;
    code?: string | null;
    stockMinor?: number | null;
    prices: Array<{
      priceListCode: "SALON" | "TAKEAWAY" | "DELIVERY";
      amountMinor: number;
    }>;
  }): ProductDto;
  updateProduct(input: UpdateProductInput): ProductDto;
  bulkUpdateProducts(input: BulkUpdateProductsInput): ProductDto[];
  createModifier(input: {
    groupName: string;
    name: string;
    priceMinor: number;
  }): import("@gastronomy/contracts").ModifierDto;
  adjustStock(input: {
    productId: Id;
    newStockMinor: number;
    reason: string;
    authorizerPin: string;
  }): ProductDto;
  createUser(input: {
    staffNumber?: number;
    fullName: string;
    roleCode: "ADMIN" | "MANAGER" | "CASHIER" | "WAITER" | "DELIVERY_DRIVER";
    pin: string;
    authorizerPin: string;
  }): import("@gastronomy/contracts").UserDto;
  createDriver(input: {
    fullName: string;
    authorizerPin: string;
  }): import("@gastronomy/contracts").UserDto;
  updateUser(input: {
    userId: Id;
    staffNumber?: number;
    roleCode: "ADMIN" | "MANAGER" | "CASHIER" | "WAITER" | "DELIVERY_DRIVER";
    active: boolean;
    newPin?: string | null;
    reason: string;
    authorizerPin: string;
  }): import("@gastronomy/contracts").UserDto;
  deleteUser(input: { userId: Id; reason: string; authorizerPin: string }): {
    deleted: true;
  };
  settleDelivery(input: SettleDeliveryInput): DeliveryLedgerDto[];
  reverseCashMovement(
    input: import("@gastronomy/contracts").ReverseCashMovementInput,
  ): CashSessionDto;
  reverseDeliverySettlement(
    input: import("@gastronomy/contracts").ReverseDeliverySettlementInput,
  ): DeliveryLedgerDto;

  configureTables(
    count: number,
  ): import("@gastronomy/contracts").RestaurantTableDto[];
  createTableSector(input: { name: string }): TableSectorDto;
  updateTableSector(input: {
    sectorId: Id;
    name: string;
    sortOrder?: number;
  }): TableSectorDto;
  deleteTableSector(input: { sectorId: Id }): {
    deleted: true;
    fallbackSectorId: Id;
  };
  updateTable(input: {
    tableId: Id;
    number: number;
    name?: string | null;
    active: boolean;
    sortOrder?: number;
    sectorId?: Id;
    layoutX?: number;
    layoutY?: number;
    layoutWidth?: number;
    layoutHeight?: number;
    shape?: import("@gastronomy/contracts").RestaurantTableDto["shape"];
  }): import("@gastronomy/contracts").RestaurantTableDto;
  deleteTable(input: { tableId: Id }): { deleted: true };
  exportSalesCsv(): string;
  getDetailedReport(filters: ReportFilters): DetailedReportDto;
  getAuditLog(input: {
    dateFrom?: BusinessDate;
    dateTo?: BusinessDate;
    action?: string;
    limit?: number;
  }): AuditEntryDto[];
  saveSettings(settings: AppSettingsDto): AppSettingsDto;
  getDashboard(businessDate?: BusinessDate): DashboardSummaryDto;
}

export class GastronomyApplication {
  constructor(private readonly repository: GastronomyRepository) {}

  private normalizeCustomerTags(tags?: string[]) {
    const normalized = [
      ...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)),
    ];
    if (normalized.length > 12 || normalized.some((tag) => tag.length > 30))
      throw new Error("Usá hasta 12 etiquetas de 30 caracteres como máximo.");
    return normalized;
  }

  private assertCustomerDetails(input: {
    preferences?: string | null;
    tags?: string[];
    preferredPaymentMethodCode?: string | null;
  }) {
    if ((input.preferences?.trim().length ?? 0) > 1_000)
      throw new Error("Las preferencias admiten hasta 1000 caracteres.");
    if ((input.preferredPaymentMethodCode?.trim().length ?? 0) > 40)
      throw new Error("El medio de pago preferido no es válido.");
    this.normalizeCustomerTags(input.tags);
  }

  bootstrap() {
    return this.repository.bootstrap();
  }

  ensureTable(input: { number: number }) {
    if (
      !Number.isInteger(input.number) ||
      input.number <= 0 ||
      input.number > 9999
    ) {
      throw new Error("Ingresá un número de mesa válido entre 1 y 9999.");
    }
    return this.repository.ensureTable(input.number);
  }

  openCashSession(input: OpenCashSessionInput) {
    nonNegativeMoney(input.openingAmountMinor, "cambio inicial");
    return this.repository.openCashSession(input);
  }

  registerCashMovement(input: CashMovementInput) {
    if (!input.reason.trim())
      throw new Error("El movimiento requiere un motivo.");
    assertMoneyMinor(input.amountMinor);
    if (input.type !== "ADJUSTMENT") nonNegativeMoney(input.amountMinor);
    return this.repository.registerCashMovement({
      ...input,
      reason: input.reason.trim(),
    });
  }

  closeCashSession(input: CloseCashSessionInput) {
    nonNegativeMoney(input.countedAmountMinor, "efectivo contado");
    if (input.closingFloatAmountMinor != null)
      nonNegativeMoney(input.closingFloatAmountMinor, "cambio final");
    if (
      input.closingFloatAmountMinor != null &&
      input.closingFloatAmountMinor > input.countedAmountMinor
    )
      throw new Error("El cambio final no puede superar el efectivo contado.");
    if (input.force && !input.reason?.trim())
      throw new Error("El cierre forzado requiere un motivo.");
    if (input.force && (!input.authorizerPin || input.authorizerPin.length < 4))
      throw new Error("El cierre forzado requiere un PIN de autorización.");
    return this.repository.closeCashSession(input);
  }

  createOrder(input: CreateOrderInput) {
    if (input.type === "DINE_IN" && !input.tableId)
      throw new Error("Seleccioná una mesa.");
    assertOffPremiseCustomer(input);
    nonNegativeMoney(input.deliveryFeeMinor ?? 0, "costo de delivery");
    return this.repository.createOrder({
      ...input,
      customerName: input.customerName?.trim() || null,
      customerPhone: input.customerPhone?.trim() || null,
      deliveryAddress: input.deliveryAddress?.trim() || null,
    });
  }

  updateDraftOrder(input: UpdateDraftOrderInput) {
    assertOffPremiseCustomer(input);
    nonNegativeMoney(input.deliveryFeeMinor ?? 0, "costo de delivery");
    return this.repository.updateDraftOrder({
      ...input,
      customerName: input.customerName?.trim() || null,
      customerPhone: input.customerPhone?.trim() || null,
      deliveryAddress: input.deliveryAddress?.trim() || null,
      notes: input.notes?.trim() || null,
    });
  }

  confirmOrder(input: ConfirmOrderInput) {
    return this.repository.confirmOrder(input);
  }
  discardDraftOrder(input: { orderId: Id }) {
    return this.repository.discardDraftOrder(input.orderId);
  }

  addOrderItem(input: AddOrderItemInput) {
    if (
      input.quantity != null &&
      (!Number.isInteger(input.quantity) || input.quantity <= 0)
    ) {
      throw new Error("La cantidad debe ser un entero positivo.");
    }
    if (input.unitPriceMinorOverride != null) {
      nonNegativeMoney(input.unitPriceMinorOverride, "precio manual");
      if (!/^\d{4,8}$/.test(input.authorizerPin ?? ""))
        throw new Error(
          "Ingresá un PIN válido para autorizar el precio manual.",
        );
    }
    return this.repository.addOrderItem(input);
  }

  updateOrderItemNotes(input: UpdateOrderItemNotesInput) {
    const notes = input.notes?.trim() || null;
    if (notes && notes.length > 500)
      throw new Error("Las observaciones admiten hasta 500 caracteres.");
    return this.repository.updateOrderItemNotes({ ...input, notes });
  }

  addHalfAndHalfItem(input: AddHalfAndHalfItemInput) {
    return this.repository.addHalfAndHalfItem(input);
  }

  removeOrderItem(input: { orderId: Id; itemId: Id }) {
    return this.repository.removeOrderItem(input.orderId, input.itemId);
  }

  addOrderItemModifier(
    input: Parameters<GastronomyRepository["addOrderItemModifier"]>[0],
  ) {
    return this.repository.addOrderItemModifier(input);
  }

  removeOrderItemModifier(input: { orderId: Id; modifierId: Id }) {
    return this.repository.removeOrderItemModifier(
      input.orderId,
      input.modifierId,
    );
  }

  applyOrderDiscount(
    input: Parameters<GastronomyRepository["applyOrderDiscount"]>[0],
  ) {
    if (!input.reason.trim())
      throw new Error("El descuento requiere un motivo.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN no es válido.");
    return this.repository.applyOrderDiscount({
      ...input,
      reason: input.reason.trim(),
    });
  }

  updateOrderStatus(input: { orderId: Id; status: OrderOperationalStatus }) {
    return this.repository.updateOrderStatus(input.orderId, input.status);
  }

  assignDeliveryDriver(
    input: Parameters<GastronomyRepository["assignDeliveryDriver"]>[0],
  ) {
    return this.repository.assignDeliveryDriver(input);
  }

  payOrder(input: PayOrderInput) {
    if (!input.payments.length)
      throw new Error("Agregá al menos un medio de pago.");
    for (const payment of input.payments) {
      nonNegativeMoney(payment.amountMinor, "pago");
      if (payment.receivedMinor != null)
        nonNegativeMoney(payment.receivedMinor, "efectivo recibido");
      if (
        payment.methodCode === "CASH" &&
        payment.receivedMinor != null &&
        payment.receivedMinor < payment.amountMinor
      ) {
        throw new Error(
          "El efectivo recibido no alcanza para el importe en efectivo.",
        );
      }
      if (payment.methodCode !== "CASH" && payment.receivedMinor != null)
        throw new Error("Sólo el efectivo admite importe recibido.");
    }
    return this.repository.payOrder(input);
  }

  refundPayment(input: RefundPaymentInput) {
    if (!input.reason.trim())
      throw new Error("La devolución requiere un motivo.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN de autorización no es válido.");
    return this.repository.refundPayment({
      ...input,
      reason: input.reason.trim(),
    });
  }

  completeOrder(input: PayOrderInput & { finalStatus: "DELIVERED" }) {
    if (!input.payments.length)
      throw new Error("Agregá al menos un medio de pago.");
    for (const payment of input.payments) {
      if (!Number.isInteger(payment.amountMinor) || payment.amountMinor <= 0)
        throw new Error("Cada pago debe tener un importe mayor que cero.");
      if (
        payment.methodCode === "CASH" &&
        payment.receivedMinor != null &&
        payment.receivedMinor < payment.amountMinor
      )
        throw new Error(
          "El efectivo recibido no alcanza para el importe en efectivo.",
        );
    }
    return this.repository.completeOrder(input);
  }

  cancelOrder(input: CancelOrderInput) {
    if (!input.reason.trim())
      throw new Error("La cancelación requiere un motivo.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN no es válido.");
    return this.repository.cancelOrder({
      ...input,
      reason: input.reason.trim(),
    });
  }

  queuePrint(input: { orderId: Id; kind: "KITCHEN_ORDER" | "CUSTOMER_BILL" }) {
    return this.repository.queuePrint(input.orderId, input.kind);
  }

  preparePrintRetry(input: { jobId: Id }) {
    return this.repository.preparePrintRetry(input.jobId);
  }

  searchCustomers(query: string) {
    return this.repository.searchCustomers(query.trim());
  }

  searchCustomersPage(input: SearchCustomersPageInput) {
    const page = Number.isFinite(input.page)
      ? Math.max(1, Math.trunc(input.page))
      : 1;
    const pageSize = Number.isFinite(input.pageSize)
      ? Math.min(100, Math.max(1, Math.trunc(input.pageSize)))
      : 24;
    return this.repository.searchCustomersPage({
      query: input.query.trim(),
      page,
      pageSize,
      status: input.status ?? "ACTIVE",
    });
  }

  getCustomerProfile(input: {
    customerId: Id;
    page: number;
    pageSize: number;
  }) {
    return this.repository.getCustomerProfile({
      customerId: input.customerId,
      page: Number.isFinite(input.page)
        ? Math.max(1, Math.trunc(input.page))
        : 1,
      pageSize: Number.isFinite(input.pageSize)
        ? Math.min(50, Math.max(1, Math.trunc(input.pageSize)))
        : 10,
    });
  }

  createCustomer(input: {
    name: string;
    phone: string;
    notes?: string | null;
    preferences?: string | null;
    tags?: string[];
    preferredPaymentMethodCode?: string | null;
    address?: string | null;
    addresses?: UpdateCustomerInput["addresses"];
  }) {
    if (!input.name.trim()) throw new Error("Ingresá el nombre del cliente.");
    if (!input.phone.trim())
      throw new Error("Ingresá el teléfono del cliente.");
    this.assertCustomerDetails(input);
    for (const address of input.addresses ?? [])
      nonNegativeMoney(address.deliveryFeeMinor ?? 0, "valor del envío");
    return this.repository.createCustomer({
      ...input,
      name: input.name.trim(),
      phone: input.phone.trim(),
      notes: input.notes?.trim() || null,
      preferences: input.preferences?.trim() || null,
      tags: this.normalizeCustomerTags(input.tags),
      preferredPaymentMethodCode:
        input.preferredPaymentMethodCode?.trim() || null,
    });
  }

  updateCustomer(input: UpdateCustomerInput) {
    if (!input.name.trim()) throw new Error("Ingresá el nombre del cliente.");
    if (!input.phone.trim())
      throw new Error("Ingresá el teléfono del cliente.");
    this.assertCustomerDetails(input);
    const addresses = input.addresses
      .map((address) => ({
        ...address,
        label: address.label.trim(),
        address: address.address.trim(),
        notes: address.notes?.trim() || null,
        deliveryFeeMinor: address.deliveryFeeMinor ?? 0,
      }))
      .filter((address) => address.address);
    if (addresses.some((address) => !address.label))
      throw new Error("Cada dirección debe tener una etiqueta.");
    for (const address of addresses)
      nonNegativeMoney(address.deliveryFeeMinor, "valor del envío");
    return this.repository.updateCustomer({
      ...input,
      name: input.name.trim(),
      phone: input.phone.trim(),
      notes: input.notes?.trim() || null,
      preferences: input.preferences?.trim() || null,
      tags: this.normalizeCustomerTags(input.tags),
      preferredPaymentMethodCode:
        input.preferredPaymentMethodCode?.trim() || null,
      addresses,
    });
  }

  setCustomerActive(
    input: Parameters<GastronomyRepository["setCustomerActive"]>[0],
  ) {
    if (input.reason.trim().length < 4)
      throw new Error("Explicá el motivo con al menos 4 caracteres.");
    return this.repository.setCustomerActive({
      ...input,
      reason: input.reason.trim(),
    });
  }

  mergeCustomers(input: Parameters<GastronomyRepository["mergeCustomers"]>[0]) {
    if (input.sourceCustomerId === input.targetCustomerId)
      throw new Error("Elegí dos fichas distintas para fusionar.");
    if (input.reason.trim().length < 4)
      throw new Error("Explicá el motivo de la fusión.");
    return this.repository.mergeCustomers({
      ...input,
      reason: input.reason.trim(),
    });
  }

  createCategory(input: { name: string }) {
    if (!input.name.trim())
      throw new Error("Ingresá el nombre de la categoría.");
    return this.repository.createCategory({ name: input.name.trim() });
  }

  updateCategory(input: Parameters<GastronomyRepository["updateCategory"]>[0]) {
    if (!input.name.trim())
      throw new Error("Ingresá el nombre de la categoría.");
    if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)
      throw new Error("El orden de la categoría no es válido.");
    if (!input.reason.trim())
      throw new Error("El cambio de categoría requiere un motivo.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN de autorización no es válido.");
    return this.repository.updateCategory({
      ...input,
      name: input.name.trim(),
      reason: input.reason.trim(),
    });
  }

  deleteCategory(input: Parameters<GastronomyRepository["deleteCategory"]>[0]) {
    if (!input.reason.trim())
      throw new Error("La eliminación requiere un motivo.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN de autorización no es válido.");
    return this.repository.deleteCategory({
      ...input,
      reason: input.reason.trim(),
    });
  }

  createProduct(input: Parameters<GastronomyRepository["createProduct"]>[0]) {
    if (!input.name.trim()) throw new Error("Ingresá el nombre del producto.");
    if (
      input.stockMinor != null &&
      (!Number.isSafeInteger(input.stockMinor) || input.stockMinor < 0)
    )
      throw new Error("El stock inicial no es válido.");
    const prices = normalizeProductPrices(input.prices);
    for (const price of prices) nonNegativeMoney(price.amountMinor, "precio");
    return this.repository.createProduct({ ...input, prices });
  }

  updateProduct(input: UpdateProductInput) {
    if (!input.name.trim()) throw new Error("Ingresá el nombre del producto.");
    if (!input.reason.trim())
      throw new Error("El cambio de producto requiere un motivo.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN de autorización no es válido.");
    const prices = normalizeProductPrices(input.prices);
    for (const price of prices) nonNegativeMoney(price.amountMinor, "precio");
    return this.repository.updateProduct({
      ...input,
      name: input.name.trim(),
      prices,
      reason: input.reason.trim(),
    });
  }

  bulkUpdateProducts(input: BulkUpdateProductsInput) {
    const productIds = [...new Set(input.productIds)];
    if (!productIds.length) throw new Error("Seleccioná al menos un producto.");
    if (productIds.length > 500)
      throw new Error("Podés modificar hasta 500 productos por operación.");
    if (!input.reason.trim())
      throw new Error("La operación masiva requiere un motivo.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN de autorización no es válido.");
    if (
      input.categoryId == null &&
      input.active == null &&
      input.priceAdjustment == null
    ) {
      throw new Error("Elegí al menos un cambio para aplicar.");
    }
    const adjustment = input.priceAdjustment;
    if (adjustment) {
      if (!adjustment.priceListCodes.length)
        throw new Error("Elegí al menos una lista de precios.");
      if (!Number.isFinite(adjustment.value))
        throw new Error("El ajuste de precio no es válido.");
      if (
        adjustment.mode === "PERCENTAGE" &&
        (adjustment.value < -100 || adjustment.value > 1000)
      ) {
        throw new Error("El porcentaje debe estar entre -100% y 1000%.");
      }
      if (
        adjustment.mode === "FIXED" &&
        !Number.isSafeInteger(adjustment.value)
      ) {
        throw new Error("El importe fijo debe expresarse en centavos.");
      }
    }
    const normalizedAdjustment = adjustment
      ? {
          ...adjustment,
          priceListCodes: [
            ...(adjustment.priceListCodes.includes("SALON")
              ? (["SALON"] as const)
              : []),
            ...(adjustment.priceListCodes.some((code) =>
              ["TAKEAWAY", "DELIVERY"].includes(code),
            )
              ? (["TAKEAWAY", "DELIVERY"] as const)
              : []),
          ],
        }
      : null;
    return this.repository.bulkUpdateProducts({
      ...input,
      productIds,
      priceAdjustment: normalizedAdjustment,
      reason: input.reason.trim(),
    });
  }

  createModifier(input: Parameters<GastronomyRepository["createModifier"]>[0]) {
    if (!input.groupName.trim() || !input.name.trim())
      throw new Error("Completá grupo y nombre del modificador.");
    nonNegativeMoney(input.priceMinor, "precio del modificador");
    return this.repository.createModifier(input);
  }

  adjustStock(input: Parameters<GastronomyRepository["adjustStock"]>[0]) {
    if (!input.reason.trim()) throw new Error("El ajuste requiere un motivo.");
    if (!Number.isInteger(input.newStockMinor) || input.newStockMinor < 0)
      throw new Error("El stock no es válido.");
    return this.repository.adjustStock(input);
  }

  createUser(input: Parameters<GastronomyRepository["createUser"]>[0]) {
    if (
      input.staffNumber !== undefined &&
      (!Number.isSafeInteger(input.staffNumber) || input.staffNumber <= 0)
    )
      throw new Error(
        "El número de usuario debe ser un entero mayor que cero.",
      );
    if (!input.fullName.trim())
      throw new Error("Ingresá el nombre del usuario.");
    if (!/^\d{4,8}$/.test(input.pin))
      throw new Error("El PIN debe tener entre 4 y 8 dígitos.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN de autorización no es válido.");
    return this.repository.createUser(input);
  }

  createDriver(input: Parameters<GastronomyRepository["createDriver"]>[0]) {
    if (!input.fullName.trim())
      throw new Error("Ingresá el nombre del repartidor.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN de autorización no es válido.");
    return this.repository.createDriver(input);
  }

  updateUser(input: Parameters<GastronomyRepository["updateUser"]>[0]) {
    if (
      input.staffNumber !== undefined &&
      (!Number.isSafeInteger(input.staffNumber) || input.staffNumber <= 0)
    )
      throw new Error(
        "El número de usuario debe ser un entero mayor que cero.",
      );
    if (!input.reason.trim()) throw new Error("El cambio requiere un motivo.");
    if (input.newPin && !/^\d{4,8}$/.test(input.newPin))
      throw new Error("El nuevo PIN debe tener entre 4 y 8 dígitos.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN de autorización no es válido.");
    return this.repository.updateUser({
      ...input,
      reason: input.reason.trim(),
    });
  }

  deleteUser(input: Parameters<GastronomyRepository["deleteUser"]>[0]) {
    if (!input?.userId) throw new Error("El usuario no es válido.");
    if (!input.reason.trim())
      throw new Error("La eliminación requiere un motivo.");
    if (!/^\d{4,8}$/.test(input.authorizerPin))
      throw new Error("El PIN de autorización no es válido.");
    return this.repository.deleteUser({
      ...input,
      reason: input.reason.trim(),
    });
  }

  settleDelivery(input: SettleDeliveryInput) {
    if (input.ledgerIds.length === 0)
      throw new Error("Seleccioná al menos un saldo pendiente para rendir.");
    if (input.reason.length < 5 || input.reason.length > 200)
      throw new Error(
        "Agregá un motivo de rendición (entre 5 y 200 caracteres).",
      );
    return this.repository.settleDelivery(input);
  }

  reverseCashMovement(
    input: import("@gastronomy/contracts").ReverseCashMovementInput,
  ) {
    if (input.reason.length < 5 || input.reason.length > 200)
      throw new Error(
        "Agregá un motivo de anulación (entre 5 y 200 caracteres).",
      );
    return this.repository.reverseCashMovement(input);
  }

  reverseDeliverySettlement(
    input: import("@gastronomy/contracts").ReverseDeliverySettlementInput,
  ) {
    if (input.reason.length < 5 || input.reason.length > 200)
      throw new Error(
        "Agregá un motivo de anulación (entre 5 y 200 caracteres).",
      );
    return this.repository.reverseDeliverySettlement(input);
  }

  configureTables(input: { count: number }) {
    return this.repository.configureTables(input.count);
  }
  createTableSector(input: { name: string }) {
    return this.repository.createTableSector(input);
  }
  updateTableSector(
    input: Parameters<GastronomyRepository["updateTableSector"]>[0],
  ) {
    return this.repository.updateTableSector(input);
  }
  deleteTableSector(input: { sectorId: Id }) {
    if (!input?.sectorId) throw new Error("El sector no es válido.");
    return this.repository.deleteTableSector(input);
  }
  updateTable(input: Parameters<GastronomyRepository["updateTable"]>[0]) {
    return this.repository.updateTable(input);
  }
  deleteTable(input: { tableId: Id }) {
    if (!input?.tableId) throw new Error("La mesa no es válida.");
    return this.repository.deleteTable(input);
  }

  exportSalesCsv() {
    return this.repository.exportSalesCsv();
  }

  listCashSessionHistory() {
    return this.repository.listCashSessionHistory();
  }

  getCashSessionReport(filters: CashSessionReportFilters) {
    if (!filters?.cashSessionId) throw new Error("La caja no es válida.");
    return this.repository.getCashSessionReport(filters);
  }

  getDetailedReport(filters: ReportFilters) {
    if (filters.dateFrom > filters.dateTo)
      throw new Error("El rango de fechas no es válido.");
    return this.repository.getDetailedReport(filters);
  }

  getAuditLog(input: {
    dateFrom?: BusinessDate;
    dateTo?: BusinessDate;
    action?: string;
    limit?: number;
  }) {
    return this.repository.getAuditLog({
      ...input,
      limit: Math.min(Math.max(input.limit ?? 200, 1), 1000),
    });
  }

  saveSettings(settings: AppSettingsDto) {
    assertAppSettings(settings);
    return this.repository.saveSettings(settings);
  }

  getDashboard(businessDate?: BusinessDate) {
    return this.repository.getDashboard(businessDate);
  }
}
