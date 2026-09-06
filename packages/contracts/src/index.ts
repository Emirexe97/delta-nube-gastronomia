export type Id = string;
export type IsoDateTime = string;
export type BusinessDate = string;
export type MoneyMinor = number;

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY";
export type OrderOperationalStatus =
  | "PENDING"
  | "IN_PREPARATION"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";
export type PaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";
export type OrderLifecycleStatus = "DRAFT" | "CONFIRMED";
export type CashSessionStatus = "OPEN" | "CLOSED";
export type CashMovementType =
  | "OPENING"
  | "SALE"
  | "INCOME"
  | "EXPENSE"
  | "WITHDRAWAL"
  | "REFUND"
  | "ADJUSTMENT"
  | "CLOSING";
export type HalfAndHalfPricingMode = "HALF_PLUS_HALF" | "MOST_EXPENSIVE";
export type ModifierScope = "FULL_PIZZA" | "FIRST_HALF" | "SECOND_HALF";
export type PrinterMode = "SYSTEM_DIALOG" | "SYSTEM_DIRECT";
export type PrinterPaperWidth = "58mm" | "80mm";

export interface PrinterProfileDto {
  profileName: string;
  deviceName: string;
  mode: PrinterMode;
  paperWidth: PrinterPaperWidth;
  charsPerLine: number;
  copies: number;
  cutter: boolean;
  cutMode: "FULL" | "PARTIAL";
  feedLinesBeforeCut: number;
}

export interface ReceiptTemplateDto {
  kitchenHeader: string;
  kitchenFooter: string;
  title: string;
  subtitle: string;
  footer: string;
  nonFiscalLegend: string;
  showOrderNumber: boolean;
  showDate: boolean;
  showTable: boolean;
  showWaiter: boolean;
  showCustomer: boolean;
  showItemQuantity: boolean;
  showItemUnitPrice: boolean;
  showItemTotal: boolean;
  showPaymentSummary: boolean;
}

export interface PrintingSettingsDto {
  terminalLabel: string;
  kitchen: PrinterProfileDto;
  bill: PrinterProfileDto;
  receiptTemplate: ReceiptTemplateDto;
}

export interface AppSettingsDto {
  businessName: string;
  currency: "ARS";
  halfAndHalfPricingMode: HalfAndHalfPricingMode;
  stockEnabled: boolean;
  maxConcurrentCashSessions: number;
  allowCloseWithPendingOrders: boolean;
  touchProductPanelEnabled: boolean;
  deliverySettlementEnabled: boolean;
  enabledOrderStatuses: OrderOperationalStatus[];
  quickDelayMinutes: number[];
  modules: {
    diningRoom: boolean;
    takeaway: boolean;
    delivery: boolean;
    modifiers: boolean;
    discounts: boolean;
    advancedStatuses: boolean;
  };
  printing: PrintingSettingsDto;
}

export interface UserDto {
  id: Id;
  staffNumber: number;
  fullName: string;
  roleCode: "ADMIN" | "MANAGER" | "CASHIER" | "WAITER" | "DELIVERY_DRIVER";
  roleName: string;
  permissions: string[];
  active: boolean;
}

export interface CategoryDto {
  id: Id;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface ProductPriceDto {
  priceListId: Id;
  priceListCode: string;
  amountMinor: MoneyMinor;
}

export interface ProductDto {
  id: Id;
  categoryId: Id;
  categoryName: string;
  name: string;
  code: string | null;
  sortOrder: number;
  active: boolean;
  stockMinor: number | null;
  prices: ProductPriceDto[];
}

export interface ModifierDto {
  id: Id;
  groupId: Id;
  groupName: string;
  name: string;
  priceMinor: MoneyMinor;
  active: boolean;
}

export interface CustomerAddressDto {
  id: Id;
  label: string;
  address: string;
  notes: string | null;
  deliveryFeeMinor: MoneyMinor;
}

export interface CustomerDto {
  id: Id;
  name: string;
  phone: string;
  notes: string | null;
  preferences: string | null;
  tags: string[];
  preferredPaymentMethodCode: string | null;
  active: boolean;
  mergedIntoCustomerId: Id | null;
  addresses: CustomerAddressDto[];
  updatedAt: IsoDateTime;
}

export interface SearchCustomersPageInput {
  query: string;
  page: number;
  pageSize: number;
  status?: "ACTIVE" | "ARCHIVED" | "ALL";
}

export interface CustomerSearchPageDto {
  items: CustomerDto[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface CustomerProfileDto {
  customer: CustomerDto;
  metrics: {
    orderCount: number;
    totalSpentMinor: MoneyMinor;
    averageTicketMinor: MoneyMinor;
    outstandingMinor: MoneyMinor;
    frequencyDays: number | null;
    lastOrderAt: IsoDateTime | null;
    usualPaymentMethodCode: string | null;
    usualPaymentMethodName: string | null;
  };
  topProducts: Array<{
    productId: Id | null;
    name: string;
    quantity: number;
    totalMinor: MoneyMinor;
  }>;
  topAddresses: Array<{
    addressId: Id | null;
    address: string;
    orderCount: number;
    lastUsedAt: IsoDateTime;
  }>;
  history: {
    items: OrderDto[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
}

export interface CustomerAddressInput {
  id?: Id;
  label: string;
  address: string;
  notes?: string | null;
  deliveryFeeMinor?: MoneyMinor;
}

export interface UpdateCustomerInput {
  customerId: Id;
  name: string;
  phone: string;
  notes?: string | null;
  preferences?: string | null;
  tags?: string[];
  preferredPaymentMethodCode?: string | null;
  addresses: CustomerAddressInput[];
  expectedUpdatedAt: IsoDateTime;
}

export interface RestaurantTableDto {
  id: Id;
  number: number;
  name: string | null;
  active: boolean;
  sortOrder: number;
  currentOrderId: Id | null;
  currentTotalMinor: MoneyMinor;
  waiterName: string | null;
  openedAt: IsoDateTime | null;
}

export interface OrderItemModifierDto {
  id: Id;
  nameSnapshot: string;
  unitPriceMinorSnapshot: MoneyMinor;
  scope: ModifierScope;
}

export interface OrderItemHalfDto {
  productId: Id;
  nameSnapshot: string;
  priceMinorSnapshot: MoneyMinor;
  position: "FIRST" | "SECOND";
}

export interface OrderItemDto {
  id: Id;
  productId: Id | null;
  productNameSnapshot: string;
  quantity: number;
  unitPriceMinorSnapshot: MoneyMinor;
  discountMinorSnapshot: MoneyMinor;
  notes: string | null;
  halves: OrderItemHalfDto[];
  modifiers: OrderItemModifierDto[];
  lineTotalMinor: MoneyMinor;
}

export interface PaymentDto {
  id: Id;
  methodCode: string;
  methodName: string;
  amountMinor: MoneyMinor;
  receivedMinor: MoneyMinor | null;
  reference: string | null;
  createdAt: IsoDateTime;
  refundedMinor: MoneyMinor;
  refundableMinor: MoneyMinor;
  status: "ACTIVE" | "PARTIALLY_REFUNDED" | "REFUNDED";
}

export interface OrderDto {
  id: Id;
  number: number;
  type: OrderType;
  operationalStatus: OrderOperationalStatus;
  paymentStatus: PaymentStatus;
  lifecycleStatus: OrderLifecycleStatus;
  cashSessionCreatedId: Id;
  cashSessionPaidId: Id | null;
  tableId: Id | null;
  tableNumber: number | null;
  customerId: Id | null;
  customerNameSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  deliveryAddressSnapshot: string | null;
  deliveryFeeMinor: MoneyMinor;
  promisedAt: IsoDateTime | null;
  scheduled: boolean;
  waiterUserId: Id | null;
  waiterName: string | null;
  driverUserId: Id | null;
  driverName: string | null;
  collectedByDriver: boolean;
  notes: string | null;
  subtotalMinor: MoneyMinor;
  discountMinor: MoneyMinor;
  totalMinor: MoneyMinor;
  paidMinor: MoneyMinor;
  printedAt: IsoDateTime | null;
  printCount: number;
  /** Intentos físicos de impresión, exitosos o fallidos. */
  printAttemptCount?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  items: OrderItemDto[];
  payments: PaymentDto[];
}

export interface CashSessionDto {
  id: Id;
  number: number;
  businessDate: BusinessDate;
  openedAt: IsoDateTime;
  closedAt: IsoDateTime | null;
  openedByUserId: Id;
  openedByName: string;
  openingAmountMinor: MoneyMinor;
  expectedAmountMinor: MoneyMinor;
  countedAmountMinor: MoneyMinor | null;
  differenceMinor: MoneyMinor | null;
  closingFloatAmountMinor?: MoneyMinor | null;
  cashRemovedAmountMinor?: MoneyMinor | null;
  floatDifferenceMinor?: MoneyMinor | null;
  cashSalesMinor?: MoneyMinor;
  cashIncomeMinor?: MoneyMinor;
  cashExpenseMinor?: MoneyMinor;
  cashWithdrawalMinor?: MoneyMinor;
  cashRefundMinor?: MoneyMinor;
  /** Ventas cobradas netas asociadas exclusivamente a esta caja. */
  salesTotalMinor?: MoneyMinor;
  salesByType?: Record<OrderType, MoneyMinor>;
  salesByPaymentMethod?: Array<{
    code: string;
    name: string;
    amountMinor: MoneyMinor;
  }>;
  status: CashSessionStatus;
}

export interface DeliveryLedgerDto {
  id: Id;
  orderId: Id;
  orderNumber: number;
  driverUserId: Id;
  driverName: string;
  restaurantAmountMinor: MoneyMinor;
  deliveryFeeMinor: MoneyMinor;
  direction: "DRIVER_OWES_BUSINESS" | "BUSINESS_OWES_DRIVER";
  amountDueMinor: MoneyMinor;
  settledAmountMinor: MoneyMinor;
  status: "PENDING" | "SETTLED";
  createdAt: IsoDateTime;
  settledAt: IsoDateTime | null;
}

export interface PaymentMethodDto {
  id: Id;
  code: string;
  name: string;
  affectsCash: boolean;
  active: boolean;
}

export interface PrintJobDto {
  id: Id;
  orderId: Id;
  orderNumber: number;
  kind: "KITCHEN_ORDER" | "CUSTOMER_BILL";
  status: "QUEUED" | "RECOVERING" | "PRINTED" | "FAILED";
  printerName: string | null;
  copies: number;
  attempts: number;
  lastError: string | null;
  createdAt: IsoDateTime;
  printedAt: IsoDateTime | null;
}

export interface DashboardSummaryDto {
  orderCount: number;
  openOrderCount: number;
  salesTotalMinor: MoneyMinor;
  averageTicketMinor: MoneyMinor;
  byType: Record<OrderType, MoneyMinor>;
  byPaymentMethod: Array<{
    code: string;
    name: string;
    amountMinor: MoneyMinor;
  }>;
}

export interface ReportFilters {
  dateFrom: BusinessDate;
  dateTo: BusinessDate;
}

export interface DetailedReportDto {
  filters: ReportFilters;
  salesTotalMinor: MoneyMinor;
  orderCount: number;
  averageTicketMinor: MoneyMinor;
  byType: Array<{
    type: OrderType;
    amountMinor: MoneyMinor;
    orderCount: number;
  }>;
  byPaymentMethod: Array<{
    code: string;
    name: string;
    amountMinor: MoneyMinor;
  }>;
  byProduct: Array<{ name: string; quantity: number; amountMinor: MoneyMinor }>;
  byCategory: Array<{
    name: string;
    quantity: number;
    amountMinor: MoneyMinor;
  }>;
  byHour: Array<{ hour: number; orderCount: number; amountMinor: MoneyMinor }>;
  byWaiter: Array<{
    name: string;
    orderCount: number;
    amountMinor: MoneyMinor;
  }>;
  cash: {
    openingMinor: MoneyMinor;
    incomeMinor: MoneyMinor;
    expenseMinor: MoneyMinor;
    withdrawalMinor: MoneyMinor;
    refundMinor: MoneyMinor;
    differencesMinor: MoneyMinor;
  };
  delivery: {
    orderCount: number;
    feesMinor: MoneyMinor;
    pendingDriverOwesMinor: MoneyMinor;
    pendingBusinessOwesMinor: MoneyMinor;
  };
}

export interface AuditEntryDto {
  id: Id;
  timestamp: IsoDateTime;
  businessDate: BusinessDate | null;
  operatorName: string | null;
  authorizerName: string | null;
  permissionUsed: string | null;
  entityType: string;
  entityId: Id;
  action: string;
  reason: string | null;
  beforeJson: string | null;
  afterJson: string | null;
}

export interface BootstrapDto {
  settings: AppSettingsDto;
  currentUser: UserDto;
  cashSession: CashSessionDto | null;
  categories: CategoryDto[];
  products: ProductDto[];
  modifiers: ModifierDto[];
  tables: RestaurantTableDto[];
  orders: OrderDto[];
  users: UserDto[];
  deliveryLedger: DeliveryLedgerDto[];
  paymentMethods: PaymentMethodDto[];
  printJobs: PrintJobDto[];
  dashboard: DashboardSummaryDto;
}

export interface IdempotentRequest {
  idempotencyKey?: string;
  terminalId?: string;
  cashSessionId?: string;
}

export interface ReverseCashMovementInput extends IdempotentRequest {
  movementId: string;
  reason: string;
  authorizerPin: string;
}

export interface ReverseDeliverySettlementInput extends IdempotentRequest {
  ledgerId: string;
  reason: string;
  authorizerPin: string;
}

export interface OpenCashSessionInput {
  openingAmountMinor: MoneyMinor;
  note?: string;
}

export interface CashMovementInput extends IdempotentRequest {
  type: Extract<
    CashMovementType,
    "INCOME" | "EXPENSE" | "WITHDRAWAL" | "ADJUSTMENT"
  >;
  amountMinor: MoneyMinor;
  reason: string;
}

export interface CloseCashSessionInput extends IdempotentRequest {
  countedAmountMinor: MoneyMinor;
  closingFloatAmountMinor?: MoneyMinor;
  force?: boolean;
  reason?: string;
  authorizerPin?: string;
}

export interface CreateOrderInput extends IdempotentRequest {
  type: OrderType;
  tableId?: Id | null;
  customerId?: Id | null;
  customerAddressId?: Id | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryFeeMinor?: MoneyMinor;
  promisedAt?: IsoDateTime | null;
  scheduled?: boolean;
  notes?: string | null;
  driverUserId?: Id | null;
  waiterUserId?: Id | null;
}

export interface UpdateDraftOrderInput extends CreateOrderInput {
  orderId: Id;
}

export interface ConfirmOrderInput extends IdempotentRequest {
  orderId: Id;
}

export interface UpdateProductInput {
  productId: Id;
  categoryId: Id;
  name: string;
  code?: string | null;
  active: boolean;
  prices: Array<{
    priceListCode: "SALON" | "TAKEAWAY" | "DELIVERY";
    amountMinor: MoneyMinor;
  }>;
  reason: string;
  authorizerPin: string;
}

export interface BulkUpdateProductsInput extends IdempotentRequest {
  productIds: Id[];
  categoryId?: Id | null;
  active?: boolean | null;
  priceAdjustment?: {
    mode: "PERCENTAGE" | "FIXED";
    value: number;
    priceListCodes: Array<"SALON" | "TAKEAWAY" | "DELIVERY">;
  } | null;
  reason: string;
  authorizerPin: string;
}

export interface RefundPaymentInput extends IdempotentRequest {
  orderId: Id;
  paymentId: Id;
  reason: string;
  authorizerPin: string;
}

export interface PrinterDeviceDto {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export interface AddOrderItemInput {
  orderId: Id;
  productId: Id;
  quantity?: number;
  notes?: string | null;
  unitPriceMinorOverride?: MoneyMinor;
  authorizerPin?: string;
}

export interface AddHalfAndHalfItemInput {
  orderId: Id;
  firstProductId: Id;
  secondProductId: Id;
  quantity?: number;
  notes?: string | null;
}

export interface PayOrderInput extends IdempotentRequest {
  orderId: Id;
  collectedByDriver?: boolean;
  payments: Array<{
    methodCode: string;
    amountMinor: MoneyMinor;
    receivedMinor?: MoneyMinor | null;
    reference?: string | null;
  }>;
}

export interface OrderActionGuardDto {
  allowed: boolean;
  reason: string | null;
  suggestedAction: "CONFIRM" | "OPEN_PAYMENT" | "DISCARD_DRAFT" | null;
}

export interface CompleteOrderInput extends PayOrderInput {
  finalStatus: "DELIVERED";
}

export interface CancelOrderInput extends IdempotentRequest {
  orderId: Id;
  reason: string;
  authorizerPin: string;
}

export interface SettleDeliveryInput extends IdempotentRequest {
  ledgerIds: Id[];
  reason: string;
  authorizerPin: string;
}

export interface DesktopApi {
  bootstrap(): Promise<BootstrapDto>;
  ensureTable(input: { number: number }): Promise<RestaurantTableDto>;
  openCashSession(input: OpenCashSessionInput): Promise<CashSessionDto>;
  registerCashMovement(input: CashMovementInput): Promise<CashSessionDto>;

  reverseCashMovement(input: ReverseCashMovementInput): Promise<CashSessionDto>;
  reverseDeliverySettlement(
    input: ReverseDeliverySettlementInput,
  ): Promise<DeliveryLedgerDto>;

  closeCashSession(input: CloseCashSessionInput): Promise<CashSessionDto>;
  createOrder(input: CreateOrderInput): Promise<OrderDto>;
  updateDraftOrder(input: UpdateDraftOrderInput): Promise<OrderDto>;
  confirmOrder(input: ConfirmOrderInput): Promise<OrderDto>;
  discardDraftOrder(input: { orderId: Id }): Promise<{ discarded: boolean }>;
  addOrderItem(input: AddOrderItemInput): Promise<OrderDto>;
  addHalfAndHalfItem(input: AddHalfAndHalfItemInput): Promise<OrderDto>;
  removeOrderItem(input: { orderId: Id; itemId: Id }): Promise<OrderDto>;
  addOrderItemModifier(input: {
    orderId: Id;
    itemId: Id;
    modifierId: Id;
    scope: ModifierScope;
  }): Promise<OrderDto>;
  removeOrderItemModifier(input: {
    orderId: Id;
    modifierId: Id;
  }): Promise<OrderDto>;
  applyOrderDiscount(input: {
    orderId: Id;
    mode: "PERCENTAGE" | "FIXED";
    value: number;
    reason: string;
    authorizerPin: string;
  }): Promise<OrderDto>;
  updateOrderStatus(input: {
    orderId: Id;
    status: OrderOperationalStatus;
  }): Promise<OrderDto>;
  assignDeliveryDriver(input: {
    orderId: Id;
    driverUserId: Id | null;
  }): Promise<OrderDto>;
  payOrder(input: PayOrderInput): Promise<OrderDto>;
  refundPayment(input: RefundPaymentInput): Promise<OrderDto>;
  completeOrder(input: CompleteOrderInput): Promise<OrderDto>;
  cancelOrder(input: CancelOrderInput): Promise<OrderDto>;
  printOrder(input: {
    orderId: Id;
    kind: "KITCHEN_ORDER" | "CUSTOMER_BILL";
  }): Promise<{ jobId: Id; status: string }>;
  retryPrint(input: { jobId: Id }): Promise<{ jobId: Id; status: string }>;
  searchCustomers(query: string): Promise<CustomerDto[]>;
  searchCustomersPage(
    input: SearchCustomersPageInput,
  ): Promise<CustomerSearchPageDto>;
  getCustomerProfile(input: {
    customerId: Id;
    page: number;
    pageSize: number;
  }): Promise<CustomerProfileDto>;
  createCustomer(input: {
    name: string;
    phone: string;
    notes?: string | null;
    preferences?: string | null;
    tags?: string[];
    preferredPaymentMethodCode?: string | null;
    address?: string | null;
    addresses?: CustomerAddressInput[];
  }): Promise<CustomerDto>;
  updateCustomer(input: UpdateCustomerInput): Promise<CustomerDto>;
  setCustomerActive(input: {
    customerId: Id;
    active: boolean;
    reason: string;
    authorizerPin: string;
  }): Promise<CustomerDto>;
  mergeCustomers(input: {
    sourceCustomerId: Id;
    targetCustomerId: Id;
    reason: string;
    authorizerPin: string;
  }): Promise<CustomerDto>;
  createCategory(input: { name: string }): Promise<CategoryDto>;
  updateCategory(input: {
    categoryId: Id;
    name: string;
    active: boolean;
    sortOrder: number;
    reason: string;
    authorizerPin: string;
  }): Promise<CategoryDto>;
  deleteCategory(input: {
    categoryId: Id;
    reason: string;
    authorizerPin: string;
  }): Promise<{ deleted: true }>;
  createProduct(input: {
    categoryId: Id;
    name: string;
    code?: string | null;
    stockMinor?: number | null;
    prices: Array<{
      priceListCode: "SALON" | "TAKEAWAY" | "DELIVERY";
      amountMinor: MoneyMinor;
    }>;
  }): Promise<ProductDto>;
  updateProduct(input: UpdateProductInput): Promise<ProductDto>;
  bulkUpdateProducts(input: BulkUpdateProductsInput): Promise<ProductDto[]>;
  createModifier(input: {
    groupName: string;
    name: string;
    priceMinor: MoneyMinor;
  }): Promise<ModifierDto>;
  adjustStock(input: {
    productId: Id;
    newStockMinor: number;
    reason: string;
    authorizerPin: string;
  }): Promise<ProductDto>;
  createUser(input: {
    staffNumber?: number;
    fullName: string;
    roleCode: "ADMIN" | "MANAGER" | "CASHIER" | "WAITER" | "DELIVERY_DRIVER";
    pin: string;
    authorizerPin: string;
  }): Promise<UserDto>;
  createDriver(input: {
    fullName: string;
    authorizerPin: string;
  }): Promise<UserDto>;
  updateUser(input: {
    userId: Id;
    staffNumber?: number;
    roleCode: "ADMIN" | "MANAGER" | "CASHIER" | "WAITER" | "DELIVERY_DRIVER";
    active: boolean;
    newPin?: string | null;
    reason: string;
    authorizerPin: string;
  }): Promise<UserDto>;
  deleteUser(input: {
    userId: Id;
    reason: string;
    authorizerPin: string;
  }): Promise<{ deleted: true }>;
  settleDelivery(input: SettleDeliveryInput): Promise<DeliveryLedgerDto[]>;

  configureTables(input: { count: number }): Promise<RestaurantTableDto[]>;
  updateTable(input: {
    tableId: Id;
    number: number;
    name?: string | null;
    active: boolean;
    sortOrder?: number;
  }): Promise<RestaurantTableDto>;
  deleteTable(input: { tableId: Id }): Promise<{ deleted: true }>;
  exportSalesCsv(): Promise<{ path: string | null }>;
  getDetailedReport(filters: ReportFilters): Promise<DetailedReportDto>;
  getAuditLog(input: {
    dateFrom?: BusinessDate;
    dateTo?: BusinessDate;
    action?: string;
    limit?: number;
  }): Promise<AuditEntryDto[]>;
  createBackup(): Promise<{ path: string | null }>;
  restoreBackup(): Promise<{ path: string | null; restored: boolean }>;
  listPrinters(): Promise<PrinterDeviceDto[]>;
  testPrinter(input: {
    kind: "KITCHEN_ORDER" | "CUSTOMER_BILL";
    settings?: AppSettingsDto;
  }): Promise<{ printed: boolean; message: string }>;
  saveSettings(settings: AppSettingsDto): Promise<AppSettingsDto>;
  getDashboard(businessDate?: BusinessDate): Promise<DashboardSummaryDto>;
}

declare global {
  interface Window {
    gastronomy: DesktopApi;
  }
}
