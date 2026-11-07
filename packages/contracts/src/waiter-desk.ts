export interface WaiterDevice {
  id: string;
  name: string;
  /** null means valid until the current cash session closes or is revoked. */
  expiresAt: string | null;
}

export interface WaiterDeskStatus {
  configured: boolean;
  printerReady: boolean;
  sessions: WaiterDevice[];
  connectionError: string | null;
}

export interface DelayedWaiterBatch {
  requestId: string;
  tableId: string;
  tableNumber: number;
  waiterName: string;
  submittedAt: string | null;
  receivedAt: string;
  status: string;
  lines: Array<{ productId: string; name: string; quantity: number; note?: string }>;
}

export interface WaiterBatchReceipt {
  requestId: string;
  orderId: string | null;
  printJobId: string | null;
  acceptedLineIds: string[];
  status: string;
  created: boolean;
}

export interface WaiterDeskApi {
  listDelayedWaiterBatches(): Promise<DelayedWaiterBatch[]>;
  confirmDelayedWaiterBatch(input: { requestId: string }): Promise<WaiterBatchReceipt>;
  rejectDelayedWaiterBatch(input: { requestId: string }): Promise<void>;
  getWaiterDeskStatus(): Promise<WaiterDeskStatus>;
  issueWaiterQr(input: {
    waiterId: string;
  }): Promise<{ image: string; expiresAt: string }>;
  revokeWaiterDevice(input: { sessionId: string }): Promise<void>;
  onWaiterOrderChanged(callback: (notice?: string) => void): () => void;
}
