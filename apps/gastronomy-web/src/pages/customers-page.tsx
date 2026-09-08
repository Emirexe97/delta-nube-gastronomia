import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  BootstrapDto,
  CustomerAddressInput,
  CustomerDto,
  CustomerProfileDto,
} from "@gastronomy/contracts";
import {
  AddressBook,
  Archive,
  ArrowUp,
  ArrowsMerge,
  CaretLeft,
  CaretRight,
  ChartLineUp,
  Eye,
  MagnifyingGlass,
  MapPin,
  PencilSimple,
  Phone,
  Plus,
  Receipt,
  ShoppingCart,
  Tag,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import {
  formatMoney,
  formatTime,
  humanError,
  parseMoneyInput,
  paymentStatusLabels,
  statusLabels,
  typeLabels,
} from "../lib";

const CUSTOMER_PAGE_SIZE = 24;

export function CustomersPage({ data }: { data: BootstrapDto }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [results, setResults] = useState<CustomerDto[]>([]);
  const [directory, setDirectory] = useState<CustomerDto[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "ARCHIVED">(
    "ACTIVE",
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerDto | null>(null);
  const [viewing, setViewing] = useState<CustomerDto | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery]);

  useEffect(() => {
    const value = debouncedQuery.trim();
    let current = true;
    setSearching(true);
    window.gastronomy
      .searchCustomersPage({
        query: value,
        page,
        pageSize: CUSTOMER_PAGE_SIZE,
        status: statusFilter,
      })
      .then((result) => {
        if (!current) return;
        setResults(result.items);
        setTotal(result.total);
        setPageCount(result.pageCount);
        if (result.page !== page) setPage(result.page);
        setDirectory((known) => {
          const byId = new Map(
            known.map((customer) => [customer.id, customer]),
          );
          for (const customer of result.items) byId.set(customer.id, customer);
          return [...byId.values()];
        });
        setError(null);
        setLoadedOnce(true);
      })
      .catch((value) => {
        if (current) setError(humanError(value));
      })
      .finally(() => {
        if (current) setSearching(false);
      });
    return () => {
      current = false;
    };
  }, [debouncedQuery, page, reload, statusFilter]);

  const waiting = query.trim() !== debouncedQuery.trim();
  const visibleResults = waiting || searching ? [] : results;
  const orderStats = useMemo(() => {
    const grouped = new Map<
      string,
      {
        count: number;
        paidMinor: number;
        totalMinor: number;
        pendingCount: number;
        lastOrderAt: string;
      }
    >();
    for (const order of data.orders) {
      if (!order.customerId || order.operationalStatus === "CANCELLED")
        continue;
      const current = grouped.get(order.customerId);
      if (!current) {
        grouped.set(order.customerId, {
          count: 1,
          paidMinor: order.paidMinor,
          totalMinor: order.totalMinor,
          pendingCount: ["DELIVERED", "CANCELLED"].includes(
            order.operationalStatus,
          )
            ? 0
            : 1,
          lastOrderAt: order.createdAt,
        });
        continue;
      }
      current.count += 1;
      current.paidMinor += order.paidMinor;
      current.totalMinor += order.totalMinor;
      if (!["DELIVERED", "CANCELLED"].includes(order.operationalStatus))
        current.pendingCount += 1;
      if (order.createdAt > current.lastOrderAt)
        current.lastOrderAt = order.createdAt;
    }
    return grouped;
  }, [data.orders]);
  const visibleOrders = visibleResults.reduce(
    (total, customer) => total + (orderStats.get(customer.id)?.count ?? 0),
    0,
  );
  const saveResult = (customer: CustomerDto) => {
    setCreateOpen(false);
    setEditing(null);
    setResults((current) => {
      const remaining = current.filter((item) => item.id !== customer.id);
      const belongs =
        statusFilter === "ACTIVE" ? customer.active : !customer.active;
      return belongs ? [customer, ...remaining] : remaining;
    });
    setDirectory((current) => [
      customer,
      ...current.filter((item) => item.id !== customer.id),
    ]);
    setViewing((current) => (current?.id === customer.id ? customer : current));
    setQuery("");
    setPage(1);
    setReload((current) => current + 1);
  };
  const range = customerResultRange(page, CUSTOMER_PAGE_SIZE, total);

  return (
    <div className="panel-enter mx-auto max-w-[1200px] space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Clientes</h2>
          <p className="text-xs text-slate-400">
            Contacto, direcciones e historial operativo de cada cliente
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={17} /> Nuevo cliente
        </Button>
      </div>
      <Card className="p-3" aria-busy={waiting || searching}>
        <div className="relative" role="search">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre, teléfono o dirección"
            aria-label="Buscar clientes"
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="mt-2 flex gap-2" aria-label="Estado de clientes">
          <Button
            type="button"
            variant={statusFilter === "ACTIVE" ? "primary" : "secondary"}
            className="h-8"
            onClick={() => {
              setStatusFilter("ACTIVE");
              setPage(1);
            }}
          >
            Activos
          </Button>
          <Button
            type="button"
            variant={statusFilter === "ARCHIVED" ? "primary" : "secondary"}
            className="h-8"
            onClick={() => {
              setStatusFilter("ARCHIVED");
              setPage(1);
            }}
          >
            <Archive size={14} /> Archivados
          </Button>
        </div>
        {waiting || searching ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-2 text-[10px] font-semibold text-brand-700"
          >
            {waiting
              ? "Esperando para buscar…"
              : query.trim()
                ? "Buscando clientes…"
                : "Cargando clientes…"}
          </p>
        ) : null}
      </Card>
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
        >
          <span>No se pudieron cargar los clientes: {error}</span>
          <Button
            type="button"
            variant="secondary"
            className="h-8"
            onClick={() => setReload((current) => current + 1)}
          >
            Reintentar
          </Button>
        </div>
      ) : null}
      <section
        aria-label="Resumen de clientes"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        <Card className="border-brand-100 bg-brand-50/45 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700">
            {query.trim()
              ? "Coincidencias"
              : statusFilter === "ACTIVE"
                ? "Clientes activos"
                : "Clientes archivados"}
          </p>
          <p className="mt-1 text-xl font-extrabold text-slate-900">
            {waiting || searching ? "—" : total}
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Con dirección · página
          </p>
          <p className="mt-1 text-xl font-extrabold text-slate-900">
            {
              visibleResults.filter((customer) => customer.addresses.length)
                .length
            }
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Pedidos · página
          </p>
          <p className="mt-1 text-xl font-extrabold text-slate-900">
            {visibleOrders}
          </p>
        </Card>
      </section>
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[11px] font-bold text-slate-500">
          {waiting || searching
            ? `Buscando “${query.trim()}”…`
            : query.trim()
              ? `Resultados para “${query.trim()}”`
              : "Directorio completo"}
        </p>
        {!waiting && !searching ? (
          <span className="text-[10px] text-slate-400">
            {total ? `${range.from}–${range.to} de ${total}` : "0 clientes"}
          </span>
        ) : null}
      </div>
      {pageCount > 1 ? (
        <nav
          aria-label="Paginación de clientes"
          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
        >
          <Button
            type="button"
            variant="secondary"
            className="h-8"
            disabled={page <= 1 || waiting || searching}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <CaretLeft size={14} /> Anterior
          </Button>
          <span className="text-[11px] font-bold text-slate-600">
            Página {page} de {pageCount}
          </span>
          <Button
            type="button"
            variant="secondary"
            className="h-8"
            disabled={page >= pageCount || waiting || searching}
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
          >
            Siguiente <CaretRight size={14} />
          </Button>
        </nav>
      ) : null}
      <section
        aria-label="Directorio de clientes"
        aria-busy={waiting || searching}
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
      >
        {visibleResults.map((customer) => {
          const stats = orderStats.get(customer.id);
          return (
            <Card key={customer.id} className="overflow-hidden p-0">
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                    <AddressBook size={20} weight="duotone" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">
                          {customer.name}
                        </p>
                        <p className="flex items-center gap-1 text-xs font-semibold text-brand-700">
                          <Phone size={12} weight="bold" /> {customer.phone}
                        </p>
                      </div>
                      <Badge tone={stats?.pendingCount ? "amber" : "slate"}>
                        {!customer.active
                          ? customer.mergedIntoCustomerId
                            ? "Fusionado"
                            : "Archivado"
                          : stats?.pendingCount
                            ? `${stats.pendingCount} pendiente${stats.pendingCount === 1 ? "" : "s"}`
                            : "Sin pendientes"}
                      </Badge>
                    </div>
                    {customer.addresses.length ? (
                      <div className="mt-2 space-y-1.5">
                        {customer.addresses.map((address, index) => (
                          <p
                            key={address.id}
                            className="flex items-start gap-1 text-[11px] text-slate-500"
                          >
                            <MapPin className="mt-0.5 shrink-0" />
                            <span>
                              <b className="text-slate-600">
                                {addressDisplayLabel(address.label, index)}:
                              </b>{" "}
                              {address.address}
                              <span className="mt-0.5 block font-semibold text-brand-700">
                                Envío: {formatMoney(address.deliveryFeeMinor)}
                              </span>
                            </span>
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-[10px] text-slate-400">
                        Sin dirección guardada
                      </p>
                    )}
                    {customer.notes ? (
                      <p className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500">
                        {customer.notes}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[10px]">
                <div className="flex items-start gap-1.5 text-slate-500">
                  <Receipt size={13} className="mt-0.5 text-brand-600" />
                  <span>
                    <span className="block">
                      <b className="text-slate-700">{stats?.count ?? 0}</b>{" "}
                      {stats?.count === 1 ? "pedido" : "pedidos"}
                    </span>
                    <span className="block text-[9px] text-slate-400">
                      {stats
                        ? `Último: ${new Date(stats.lastOrderAt).toLocaleDateString("es-AR")}`
                        : "Sin compras registradas"}
                    </span>
                  </span>
                </div>
                <div className="text-right text-slate-500">
                  Cobrado:{" "}
                  <b className="text-slate-700">
                    {formatMoney(stats?.paidMinor ?? 0)}
                  </b>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3">
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={`Ver ficha de ${customer.name}`}
                  onClick={() => setViewing(customer)}
                >
                  <Eye size={15} /> Ver ficha
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={`Editar ${customer.name}`}
                  onClick={() => setEditing(customer)}
                >
                  <PencilSimple size={15} /> Editar
                </Button>
              </div>
            </Card>
          );
        })}
      </section>
      {pageCount > 1 && !waiting && !searching ? (
        <p className="text-center text-[10px] font-semibold text-slate-400">
          Mostrando {range.from}–{range.to} de {total} clientes
        </p>
      ) : null}
      {!waiting && !searching && loadedOnce && !error && !results.length ? (
        <div className="grid h-52 place-items-center text-center">
          <div>
            <AddressBook className="mx-auto text-slate-300" size={36} />
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {debouncedQuery.trim()
                ? "No encontramos ese cliente"
                : "Todavía no hay clientes cargados"}
            </p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => setCreateOpen(true)}
            >
              <Plus />{" "}
              {debouncedQuery.trim() ? "Crearlo ahora" : "Nuevo cliente"}
            </Button>
          </div>
        </div>
      ) : null}
      <CustomerModal
        open={createOpen || Boolean(editing)}
        customer={editing}
        initialQuery={query}
        knownCustomers={directory}
        paymentMethods={data.paymentMethods}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        onSaved={saveResult}
      />
      <CustomerProfileModal
        customer={viewing}
        paymentMethods={data.paymentMethods}
        onClose={() => setViewing(null)}
        onEdit={() => {
          if (!viewing) return;
          setEditing(viewing);
          setViewing(null);
        }}
        onUpdated={(customer) => {
          saveResult(customer);
          setViewing(customer);
          setReload((current) => current + 1);
        }}
        onNewOrder={(customer) => {
          setViewing(null);
          navigate(
            `/pedidos?nuevo=DELIVERY&cliente=${encodeURIComponent(customer.id)}`,
          );
        }}
      />
    </div>
  );
}

type EditableAddress = Omit<CustomerAddressInput, "deliveryFeeMinor"> & {
  key: string;
  deliveryFee: string;
};

type AddressRowIssue = {
  key: string;
  message: string;
};

export type PotentialCustomerDuplicate = {
  customerId: string;
  customerName: string;
  reasons: string[];
};

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es-AR");

const normalizePhone = (value: string) => value.replace(/\D/g, "");

export function customerResultRange(
  page: number,
  pageSize: number,
  total: number,
) {
  if (total <= 0) return { from: 0, to: 0 };
  const from = (Math.max(1, page) - 1) * pageSize + 1;
  return { from, to: Math.min(total, from + pageSize - 1) };
}

export function filterCustomersForQuery(
  customers: CustomerDto[],
  query: string,
) {
  const normalized = normalizeText(query);
  const digits = normalizePhone(query);
  const hasLetters = /[a-záéíóúñ]/i.test(query);
  if (!normalized) return customers;
  return customers.filter((customer) => {
    const text = normalizeText(
      `${customer.name} ${customer.phone} ${customer.addresses
        .map((address) => `${address.address} ${address.notes ?? ""}`)
        .join(" ")}`,
    );
    if (hasLetters) return text.includes(normalized);
    if (digits) return normalizePhone(customer.phone).includes(digits);
    return text.includes(normalized);
  });
}

export function addressDisplayLabel(label: string, index: number) {
  const clean = label.trim();
  if (index === 0)
    return clean && normalizeText(clean) !== "principal"
      ? `Principal · ${clean}`
      : "Principal";
  return !clean || normalizeText(clean) === "principal"
    ? `Alternativa ${index}`
    : clean;
}

export function findPotentialCustomerDuplicates(
  customers: CustomerDto[],
  input: {
    customerId?: string | null;
    name: string;
    phone: string;
    addresses: Array<{ address: string }>;
  },
): PotentialCustomerDuplicate[] {
  const name = normalizeText(input.name);
  const phone = normalizePhone(input.phone);
  const addresses = new Set(
    input.addresses
      .map((address) => normalizeText(address.address))
      .filter(Boolean),
  );
  return customers.flatMap((customer) => {
    if (customer.id === input.customerId) return [];
    const reasons: string[] = [];
    if (name && normalizeText(customer.name) === name)
      reasons.push("mismo nombre");
    if (phone && normalizePhone(customer.phone) === phone)
      reasons.push("mismo teléfono");
    if (
      addresses.size &&
      customer.addresses.some((address) =>
        addresses.has(normalizeText(address.address)),
      )
    )
      reasons.push("misma dirección");
    return reasons.length
      ? [{ customerId: customer.id, customerName: customer.name, reasons }]
      : [];
  });
}

export function validateAddressRows(addresses: EditableAddress[]) {
  const issues: AddressRowIssue[] = [];
  const seen = new Set<string>();
  const valid: CustomerAddressInput[] = [];
  addresses.forEach((row, index) => {
    const address = row.address.trim();
    const notes = row.notes?.trim() ?? "";
    const fee = parseMoneyInput(row.deliveryFee);
    const generatedLabel =
      !row.label.trim() || normalizeText(row.label) === "principal"
        ? index === 0
          ? "Casa"
          : `Alternativa ${index}`
        : row.label.trim();
    const hasPartialContent =
      Boolean(address || notes) ||
      (row.deliveryFee.trim() !== "" && fee !== 0) ||
      !["casa", `alternativa ${index}`].includes(normalizeText(row.label));
    if (!address) {
      if (hasPartialContent)
        issues.push({
          key: row.key,
          message: "Completá la dirección o eliminá esta fila incompleta.",
        });
      return;
    }
    if (fee == null) {
      issues.push({
        key: row.key,
        message: "Ingresá un valor de envío válido.",
      });
      return;
    }
    const normalizedAddress = normalizeText(address);
    if (seen.has(normalizedAddress)) {
      issues.push({
        key: row.key,
        message: "Esta dirección está repetida dentro de la ficha.",
      });
      return;
    }
    seen.add(normalizedAddress);
    valid.push({
      id: row.id,
      label: generatedLabel,
      address,
      notes: notes || null,
      deliveryFeeMinor: fee,
    });
  });
  return { issues, valid };
}

function customerFingerprint(
  name: string,
  phone: string,
  notes: string,
  addresses: EditableAddress[],
  preferences = "",
  tags = "",
  preferredPaymentMethodCode = "",
) {
  return JSON.stringify({
    name,
    phone,
    notes,
    preferences,
    tags,
    preferredPaymentMethodCode,
    addresses: addresses.map(({ key: _key, ...address }) => address),
  });
}

const editableMoney = (amountMinor: number) =>
  (amountMinor / 100).toLocaleString("es-AR", {
    useGrouping: false,
    maximumFractionDigits: 2,
  });

function emptyAddress(index: number): EditableAddress {
  return {
    key: `${Date.now()}-${index}-${Math.random()}`,
    label: index === 0 ? "Casa" : `Alternativa ${index}`,
    address: "",
    notes: null,
    deliveryFee: "0",
  };
}

function CustomerModal({
  open,
  customer,
  initialQuery,
  knownCustomers,
  paymentMethods,
  onClose,
  onSaved,
}: {
  open: boolean;
  customer: CustomerDto | null;
  initialQuery: string;
  knownCustomers: CustomerDto[];
  paymentMethods: BootstrapDto["paymentMethods"];
  onClose(): void;
  onSaved(value: CustomerDto): void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [preferences, setPreferences] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [preferredPaymentMethodCode, setPreferredPaymentMethodCode] =
    useState("");
  const [baseUpdatedAt, setBaseUpdatedAt] = useState("");
  const [conflict, setConflict] = useState<CustomerDto | null>(null);
  const [addresses, setAddresses] = useState<EditableAddress[]>([]);
  const latestAddressesRef = useRef<EditableAddress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [initialFingerprint, setInitialFingerprint] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const mutation = useApiMutation(
    async (input: {
      name: string;
      phone: string;
      notes: string | null;
      preferences: string | null;
      tags: string[];
      preferredPaymentMethodCode: string | null;
      addresses: CustomerAddressInput[];
    }) =>
      customer
        ? window.gastronomy.updateCustomer({
            customerId: customer.id,
            expectedUpdatedAt: baseUpdatedAt || customer.updatedAt,
            ...input,
          })
        : window.gastronomy.createCustomer(input),
    {
      onSuccess: onSaved,
      onError: (value) => {
        const message = humanError(value);
        setError(message);
        if (customer && /otra ventana|Recargá la ficha/i.test(message))
          void window.gastronomy
            .getCustomerProfile({
              customerId: customer.id,
              page: 1,
              pageSize: 1,
            })
            .then((profile) => setConflict(profile.customer));
      },
    },
  );

  useLayoutEffect(() => {
    if (!open) return;
    const looksLikePhone =
      /^[+\d\s()-]+$/.test(initialQuery.trim()) &&
      normalizePhone(initialQuery).length >= 6;
    const looksLikeAddress =
      /\p{L}/u.test(initialQuery) &&
      /\d/.test(initialQuery) &&
      /\s/.test(initialQuery.trim());
    const nextName =
      customer?.name ??
      (looksLikePhone || looksLikeAddress ? "" : initialQuery);
    const nextPhone = customer?.phone ?? (looksLikePhone ? initialQuery : "");
    const nextNotes = customer?.notes ?? "";
    const nextPreferences = customer?.preferences ?? "";
    const nextTagsText = customer?.tags.join(", ") ?? "";
    const nextPreferredPayment = customer?.preferredPaymentMethodCode ?? "";
    const nextAddresses = customer?.addresses.length
      ? customer.addresses.map((address, index) => ({
          ...address,
          key: address.id,
          label:
            !address.label.trim() ||
            normalizeText(address.label) === "principal"
              ? index === 0
                ? "Casa"
                : `Alternativa ${index}`
              : address.label,
          deliveryFee: editableMoney(address.deliveryFeeMinor),
        }))
      : [
          {
            ...emptyAddress(0),
            address: looksLikeAddress ? initialQuery.trim() : "",
          },
        ];
    setName(nextName);
    setPhone(nextPhone);
    setNotes(nextNotes);
    setPreferences(nextPreferences);
    setTagsText(nextTagsText);
    setPreferredPaymentMethodCode(nextPreferredPayment);
    setBaseUpdatedAt(customer?.updatedAt ?? "");
    setConflict(null);
    setAddresses(nextAddresses);
    latestAddressesRef.current = nextAddresses;
    setInitialFingerprint(
      customerFingerprint(
        nextName,
        nextPhone,
        nextNotes,
        nextAddresses,
        nextPreferences,
        nextTagsText,
        nextPreferredPayment,
      ),
    );
    setConfirmClose(false);
    setError(null);
  }, [customer, initialQuery, open]);

  const applyRemoteCustomer = (remote: CustomerDto) => {
    const nextAddresses = remote.addresses.length
      ? remote.addresses.map((address, index) => ({
          ...address,
          key: address.id,
          label:
            !address.label.trim() ||
            normalizeText(address.label) === "principal"
              ? index === 0
                ? "Casa"
                : `Alternativa ${index}`
              : address.label,
          deliveryFee: editableMoney(address.deliveryFeeMinor),
        }))
      : [emptyAddress(0)];
    setName(remote.name);
    setPhone(remote.phone);
    setNotes(remote.notes ?? "");
    setPreferences(remote.preferences ?? "");
    setTagsText(remote.tags.join(", "));
    setPreferredPaymentMethodCode(remote.preferredPaymentMethodCode ?? "");
    setAddresses(nextAddresses);
    latestAddressesRef.current = nextAddresses;
    setBaseUpdatedAt(remote.updatedAt);
    setInitialFingerprint(
      customerFingerprint(
        remote.name,
        remote.phone,
        remote.notes ?? "",
        nextAddresses,
        remote.preferences ?? "",
        remote.tags.join(", "),
        remote.preferredPaymentMethodCode ?? "",
      ),
    );
    setConflict(null);
    setError(null);
  };

  const updateAddress = (
    key: string,
    field: "label" | "address" | "notes" | "deliveryFee",
    value: string,
  ) => {
    setConfirmClose(false);
    setError(null);
    latestAddressesRef.current = latestAddressesRef.current.map((address) =>
      address.key === key ? { ...address, [field]: value } : address,
    );
    setAddresses((current) =>
      current.map((address) =>
        address.key === key ? { ...address, [field]: value } : address,
      ),
    );
  };

  const addressValidation = validateAddressRows(addresses);
  const currentFingerprint = customerFingerprint(
    name,
    phone,
    notes,
    addresses,
    preferences,
    tagsText,
    preferredPaymentMethodCode,
  );
  const dirty = Boolean(
    initialFingerprint && currentFingerprint !== initialFingerprint,
  );
  const nameValid = name.trim().length >= 2;
  const phoneValid = normalizePhone(phone).length >= 6;
  const duplicates = findPotentialCustomerDuplicates(knownCustomers, {
    customerId: customer?.id,
    name,
    phone,
    addresses: addressValidation.valid,
  });
  const requestClose = () => {
    if (mutation.isPending) return;
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={requestClose}
      width="max-w-3xl"
      title={customer ? `Editar · ${customer.name}` : "Nuevo cliente"}
      description="La primera dirección es la principal y se selecciona por defecto en delivery."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const submittedName = String(formData.get("customerName") ?? "");
          const submittedPhone = String(formData.get("customerPhone") ?? "");
          const submittedNotes = String(formData.get("customerNotes") ?? "");
          const submittedAddressRows = latestAddressesRef.current.map(
            (row, index) => ({
              ...row,
              label: String(formData.get(`addressLabel-${index}`) ?? row.label),
              address: String(
                formData.get(`addressValue-${index}`) ?? row.address,
              ),
              notes: String(
                formData.get(`addressNotes-${index}`) ?? row.notes ?? "",
              ),
              deliveryFee: String(
                formData.get(`addressFee-${index}`) ?? row.deliveryFee,
              ),
            }),
          );
          const submittedAddressValidation =
            validateAddressRows(submittedAddressRows);
          if (
            submittedName.trim().length < 2 ||
            normalizePhone(submittedPhone).length < 6 ||
            submittedAddressValidation.issues.length
          ) {
            setError(
              submittedAddressValidation.issues[0]?.message ??
                "Revisá el nombre y el teléfono antes de guardar.",
            );
            return;
          }
          mutation.mutate({
            name: submittedName.trim(),
            phone: submittedPhone.trim(),
            notes: submittedNotes.trim() || null,
            preferences:
              String(
                formData.get("customerPreferences") ?? preferences,
              ).trim() || null,
            tags: String(formData.get("customerTags") ?? tagsText)
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
            preferredPaymentMethodCode:
              String(
                formData.get("preferredPaymentMethodCode") ??
                  preferredPaymentMethodCode,
              ).trim() || null,
            addresses: submittedAddressValidation.valid,
          });
        }}
        className="grid gap-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Teléfono"
            hint={
              phone && !phoneValid
                ? "Ingresá al menos 6 dígitos."
                : "Puede compartirse entre integrantes de una familia."
            }
          >
            <Input
              autoFocus
              name="customerPhone"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setConfirmClose(false);
              }}
              inputMode="tel"
              maxLength={40}
              aria-invalid={Boolean(phone && !phoneValid)}
              required
            />
          </Field>
          <Field
            label="Nombre"
            hint={
              name && !nameValid
                ? "Ingresá un nombre más descriptivo."
                : undefined
            }
          >
            <Input
              name="customerName"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setConfirmClose(false);
              }}
              aria-invalid={Boolean(name && !nameValid)}
              maxLength={120}
              required
            />
          </Field>
        </div>
        <Field label="Notas del cliente">
          <Textarea
            name="customerNotes"
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setConfirmClose(false);
            }}
            placeholder="Preferencias, indicaciones generales o datos útiles"
            maxLength={1000}
            className="min-h-20"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Etiquetas"
            hint="Separadas por coma: frecuente, empresa, no llamar…"
          >
            <Input
              name="customerTags"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="Frecuente, Empresa"
              maxLength={380}
            />
          </Field>
          <Field label="Medio de pago preferido">
            <Select
              name="preferredPaymentMethodCode"
              value={preferredPaymentMethodCode}
              onChange={(event) =>
                setPreferredPaymentMethodCode(event.target.value)
              }
            >
              <option value="">Sin preferencia</option>
              {paymentMethods
                .filter((method) => method.active)
                .map((method) => (
                  <option key={method.id} value={method.code}>
                    {method.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <Field label="Preferencias operativas">
          <Textarea
            name="customerPreferences"
            value={preferences}
            onChange={(event) => setPreferences(event.target.value)}
            placeholder="Productos habituales, horarios, contacto, indicaciones…"
            maxLength={1000}
            className="min-h-16"
          />
        </Field>
        {duplicates.length ? (
          <div
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
          >
            <p className="flex items-center gap-1.5 font-bold">
              <WarningCircle size={16} weight="fill" /> Posibles coincidencias
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {duplicates.map((duplicate) => (
                <li key={duplicate.customerId}>
                  {duplicate.customerName}: {duplicate.reasons.join(", ")}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10px]">
              Es sólo una advertencia: podés guardar igualmente, incluso si el
              teléfono es compartido.
            </p>
          </div>
        ) : null}
        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-extrabold text-slate-700">
                Direcciones
              </h3>
              <p className="text-[10px] text-slate-500">
                La primera se considera principal.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setConfirmClose(false);
                setAddresses((current) => {
                  const next = [...current, emptyAddress(current.length)];
                  latestAddressesRef.current = next;
                  return next;
                });
              }}
            >
              <Plus size={14} /> Agregar dirección
            </Button>
          </div>
          {addresses.map((address, index) => (
            <div
              key={address.key}
              className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[130px_1fr_auto]"
            >
              <Field
                label={
                  index === 0
                    ? "Etiqueta de la dirección principal"
                    : "Etiqueta"
                }
              >
                {index === 0 ? (
                  <span className="mb-1 inline-flex w-fit rounded-md bg-brand-50 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-brand-700">
                    Dirección principal
                  </span>
                ) : null}
                <Input
                  name={`addressLabel-${index}`}
                  value={address.label}
                  onChange={(event) =>
                    updateAddress(address.key, "label", event.target.value)
                  }
                  placeholder={index === 0 ? "Casa" : "Trabajo, Familiar…"}
                  maxLength={60}
                />
              </Field>
              <div className="grid gap-2">
                <Field label="Dirección">
                  <Input
                    name={`addressValue-${index}`}
                    value={address.address}
                    onChange={(event) =>
                      updateAddress(address.key, "address", event.target.value)
                    }
                    placeholder="Calle, número y referencia"
                    maxLength={240}
                    aria-invalid={addressValidation.issues.some(
                      (issue) => issue.key === address.key,
                    )}
                  />
                </Field>
                <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                  <Field label="Referencia">
                    <Input
                      name={`addressNotes-${index}`}
                      value={address.notes ?? ""}
                      onChange={(event) =>
                        updateAddress(address.key, "notes", event.target.value)
                      }
                      placeholder="Timbre, piso, color del portón…"
                      maxLength={500}
                    />
                  </Field>
                  <Field
                    label="Valor del envío"
                    hint="Se completa al elegir esta dirección."
                  >
                    <Input
                      name={`addressFee-${index}`}
                      value={address.deliveryFee}
                      onChange={(event) =>
                        updateAddress(
                          address.key,
                          "deliveryFee",
                          event.target.value,
                        )
                      }
                      inputMode="decimal"
                      className={
                        parseMoneyInput(address.deliveryFee) == null
                          ? "border-rose-300"
                          : ""
                      }
                      aria-invalid={
                        parseMoneyInput(address.deliveryFee) == null
                      }
                    />
                  </Field>
                </div>
                {addressValidation.issues
                  .filter((issue) => issue.key === address.key)
                  .map((issue) => (
                    <p
                      key={issue.message}
                      role="alert"
                      className="text-[10px] font-semibold text-rose-700"
                    >
                      {issue.message}
                    </p>
                  ))}
              </div>
              <div className="flex items-start gap-1 pt-6">
                {index > 0 ? (
                  <button
                    type="button"
                    title="Hacer principal"
                    aria-label={`Hacer principal ${address.label}`}
                    onClick={() => {
                      setConfirmClose(false);
                      setAddresses((current) => [
                        current[index]!,
                        ...current.filter((_, position) => position !== index),
                      ]);
                    }}
                    className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:text-brand-700"
                  >
                    <ArrowUp size={14} />
                  </button>
                ) : null}
                {addresses.length > 1 ? (
                  <button
                    type="button"
                    title="Eliminar dirección"
                    aria-label={`Eliminar dirección ${index + 1}`}
                    onClick={() => {
                      setConfirmClose(false);
                      setAddresses((current) => {
                        const next = current.filter(
                          (item) => item.key !== address.key,
                        );
                        latestAddressesRef.current = next;
                        return next;
                      });
                    }}
                    className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50"
                  >
                    <Trash size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </section>
        {error ? (
          <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              !name.trim() ||
              !phone.trim() ||
              !nameValid ||
              !phoneValid ||
              addressValidation.issues.length > 0 ||
              mutation.isPending
            }
          >
            {customer ? "Guardar cambios" : "Guardar cliente"}
          </Button>
        </div>
      </form>
      <Modal
        open={Boolean(conflict)}
        onClose={() => setConflict(null)}
        title="La ficha cambió en otra ventana"
        description="Compará los datos antes de decidir. Nada se sobrescribe automáticamente."
      >
        {conflict ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <ConflictColumn
                title="Tu borrador"
                name={name}
                phone={phone}
                notes={notes}
                addresses={addresses.map((address) => address.address)}
              />
              <ConflictColumn
                title="Versión guardada"
                name={conflict.name}
                phone={conflict.phone}
                notes={conflict.notes ?? ""}
                addresses={conflict.addresses.map((address) => address.address)}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConflict(null)}
              >
                Seguir comparando
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => applyRemoteCustomer(conflict)}
              >
                Recargar versión guardada
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setBaseUpdatedAt(conflict.updatedAt);
                  setConflict(null);
                  setError(
                    "Borrador conservado. Revisalo y volvé a guardar para aplicar tus cambios.",
                  );
                }}
              >
                Conservar mi borrador
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Cambios sin guardar"
        description="La ficha todavía tiene modificaciones pendientes."
      >
        <div className="grid gap-4">
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Si salís ahora se perderán los cambios de este formulario.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmClose(false)}
            >
              Seguir editando
            </Button>
            <Button type="button" variant="danger" onClick={onClose}>
              Descartar cambios
            </Button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}

function ConflictColumn({
  title,
  name,
  phone,
  notes,
  addresses,
}: {
  title: string;
  name: string;
  phone: string;
  notes: string;
  addresses: string[];
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
      <h3 className="font-extrabold text-slate-800">{title}</h3>
      <dl className="mt-2 space-y-1 text-slate-600">
        <div>
          <dt className="inline font-bold">Nombre: </dt>
          <dd className="inline">{name || "—"}</dd>
        </div>
        <div>
          <dt className="inline font-bold">Teléfono: </dt>
          <dd className="inline">{phone || "—"}</dd>
        </div>
        <div>
          <dt className="inline font-bold">Notas: </dt>
          <dd className="inline">{notes || "—"}</dd>
        </div>
        <div>
          <dt className="font-bold">Direcciones:</dt>
          <dd>{addresses.filter(Boolean).join(" · ") || "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

function CustomerProfileModal({
  customer,
  paymentMethods,
  onClose,
  onEdit,
  onUpdated,
  onNewOrder,
}: {
  customer: CustomerDto | null;
  paymentMethods: BootstrapDto["paymentMethods"];
  onClose(): void;
  onEdit(): void;
  onUpdated(customer: CustomerDto): void;
  onNewOrder(customer: CustomerDto): void;
}) {
  const [profile, setProfile] = useState<CustomerProfileDto | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    if (!customer) {
      setProfile(null);
      return;
    }
    let current = true;
    setLoading(true);
    window.gastronomy
      .getCustomerProfile({ customerId: customer.id, page, pageSize: 10 })
      .then((result) => {
        if (!current) return;
        setProfile(result);
        setPage(result.history.page);
        setError(null);
      })
      .catch((value) => current && setError(humanError(value)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [customer, page]);

  useEffect(() => setPage(1), [customer?.id]);

  const currentCustomer = profile?.customer ?? customer;
  const preferredPayment = paymentMethods.find(
    (method) => method.code === currentCustomer?.preferredPaymentMethodCode,
  );
  const metrics = profile?.metrics;
  return (
    <Modal
      open={Boolean(customer)}
      onClose={onClose}
      width="max-w-5xl"
      title={
        currentCustomer ? `Ficha · ${currentCustomer.name}` : "Ficha de cliente"
      }
      description="Historial completo, hábitos de compra, direcciones y calidad del padrón."
    >
      {currentCustomer ? (
        <div className="space-y-4" aria-busy={loading}>
          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
            >
              {error}
            </p>
          ) : null}
          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <Card className="p-3 sm:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Contacto
              </p>
              <p className="mt-1 text-sm font-extrabold text-slate-900">
                {currentCustomer.name}
              </p>
              <a
                className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline"
                href={`tel:${currentCustomer.phone}`}
              >
                <Phone size={13} /> {currentCustomer.phone}
              </a>
              <div className="mt-2 flex flex-wrap gap-1">
                {currentCustomer.tags.map((tag) => (
                  <Badge key={tag} tone="amber">
                    <Tag size={10} /> {tag}
                  </Badge>
                ))}
                {!currentCustomer.active ? (
                  <Badge tone="slate">
                    {currentCustomer.mergedIntoCustomerId
                      ? "Ficha fusionada"
                      : "Archivado"}
                  </Badge>
                ) : null}
              </div>
            </Card>
            <MetricCard
              label="Pedidos"
              value={String(metrics?.orderCount ?? 0)}
            />
            <MetricCard
              label="Ticket promedio"
              value={formatMoney(metrics?.averageTicketMinor ?? 0)}
            />
            <MetricCard
              label="Frecuencia"
              value={
                metrics?.frequencyDays == null
                  ? "Sin patrón"
                  : `Cada ${metrics.frequencyDays} días`
              }
            />
            <MetricCard
              label="Total histórico"
              value={formatMoney(metrics?.totalSpentMinor ?? 0)}
            />
          </section>

          <section className="grid gap-3 lg:grid-cols-2">
            <Card className="p-3">
              <h3 className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700">
                <ChartLineUp size={15} className="text-brand-600" /> Hábitos y
                preferencias
              </h3>
              <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-2">
                  <dt className="font-bold text-slate-500">Pago habitual</dt>
                  <dd className="mt-0.5 text-slate-800">
                    {metrics?.usualPaymentMethodName ?? "Sin datos"}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <dt className="font-bold text-slate-500">Pago preferido</dt>
                  <dd className="mt-0.5 text-slate-800">
                    {preferredPayment?.name ?? "Sin preferencia"}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-2 sm:col-span-2">
                  <dt className="font-bold text-slate-500">
                    Preferencias operativas
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate-800">
                    {currentCustomer.preferences ||
                      "Sin preferencias registradas"}
                  </dd>
                </div>
              </dl>
            </Card>
            <Card className="p-3">
              <h3 className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700">
                <ShoppingCart size={15} className="text-brand-600" /> Productos
                habituales
              </h3>
              {profile?.topProducts.length ? (
                <div className="mt-2 space-y-1.5">
                  {profile.topProducts.slice(0, 5).map((product) => (
                    <div
                      key={`${product.productId}-${product.name}`}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs"
                    >
                      <span className="font-semibold text-slate-700">
                        {product.name}
                      </span>
                      <span className="text-slate-500">
                        {product.quantity} u. ·{" "}
                        {formatMoney(product.totalMinor)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-400">
                  Todavía no hay productos habituales.
                </p>
              )}
            </Card>
          </section>

          <section className="rounded-xl border border-slate-200 p-3">
            <h3 className="text-xs font-extrabold text-slate-700">
              Direcciones y uso real
            </h3>
            {currentCustomer.addresses.length ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {currentCustomer.addresses.map((address, index) => {
                  const usage = profile?.topAddresses.find(
                    (item) =>
                      item.addressId === address.id ||
                      normalizeText(item.address) ===
                        normalizeText(address.address),
                  );
                  return (
                    <article
                      key={address.id}
                      className="rounded-lg bg-slate-50 p-3 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-extrabold text-slate-700">
                          {addressDisplayLabel(address.label, index)}
                        </p>
                        <Badge tone={usage ? "amber" : "slate"}>
                          {usage
                            ? `${usage.orderCount} uso${usage.orderCount === 1 ? "" : "s"}`
                            : "Sin uso"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-slate-600">{address.address}</p>
                      <p className="mt-2 font-bold text-brand-700">
                        Envío: {formatMoney(address.deliveryFeeMinor)}
                      </p>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                No tiene direcciones guardadas.
              </p>
            )}
            {profile?.topAddresses.some((address) => !address.addressId) ? (
              <div className="mt-3 border-t border-slate-100 pt-2">
                <p className="text-[10px] font-bold uppercase text-slate-400">
                  Direcciones históricas no guardadas
                </p>
                {profile.topAddresses
                  .filter((address) => !address.addressId)
                  .map((address) => (
                    <p
                      key={address.address}
                      className="mt-1 text-xs text-slate-600"
                    >
                      {address.address} · {address.orderCount} pedidos
                    </p>
                  ))}
              </div>
            ) : null}
          </section>

          {currentCustomer.notes ? (
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-xs font-extrabold text-slate-700">Notas</h3>
              <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                {currentCustomer.notes}
              </p>
            </section>
          ) : null}

          <section aria-labelledby="customer-full-history-title">
            <div className="flex items-center justify-between gap-2">
              <h3
                id="customer-full-history-title"
                className="text-xs font-extrabold text-slate-700"
              >
                Historial completo
              </h3>
              <span className="text-[10px] text-slate-400">
                {profile?.history.total ?? 0} registros
              </span>
            </div>
            {profile?.history.items.length ? (
              <div className="mt-2 overflow-auto rounded-xl border border-slate-200">
                <table className="dn-table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Canal</th>
                      <th>Estado</th>
                      <th>Pago</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.history.items.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <b>#{order.number}</b>
                          <span className="block text-[9px] text-slate-400">
                            {new Date(order.createdAt).toLocaleDateString(
                              "es-AR",
                            )}{" "}
                            · {formatTime(order.createdAt)}
                          </span>
                        </td>
                        <td>{typeLabels[order.type]}</td>
                        <td>
                          {order.lifecycleStatus === "DRAFT"
                            ? "Borrador"
                            : statusLabels[order.operationalStatus]}
                        </td>
                        <td>{paymentStatusLabels[order.paymentStatus]}</td>
                        <td className="text-right font-bold">
                          {formatMoney(order.totalMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-400">
                Todavía no hay pedidos vinculados a esta ficha.
              </div>
            )}
            {(profile?.history.pageCount ?? 0) > 1 ? (
              <div className="mt-2 flex items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <CaretLeft /> Anterior
                </Button>
                <span className="text-[10px] font-bold text-slate-500">
                  Página {profile?.history.page} de {profile?.history.pageCount}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8"
                  disabled={
                    page >= (profile?.history.pageCount ?? 1) || loading
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  Siguiente <CaretRight />
                </Button>
              </div>
            ) : null}
          </section>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            {currentCustomer.active ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setMergeOpen(true)}
              >
                <ArrowsMerge size={15} /> Fusionar duplicado
              </Button>
            ) : null}
            {!currentCustomer.mergedIntoCustomerId ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStatusOpen(true)}
              >
                <Archive size={15} />{" "}
                {currentCustomer.active ? "Archivar" : "Reactivar"}
              </Button>
            ) : null}
            {currentCustomer.active ? (
              <>
                <Button type="button" variant="secondary" onClick={onEdit}>
                  <PencilSimple size={15} /> Editar datos
                </Button>
                <Button
                  type="button"
                  onClick={() => onNewOrder(currentCustomer)}
                >
                  <Plus size={15} /> Nuevo pedido
                </Button>
              </>
            ) : null}
          </div>

          <CustomerStatusModal
            customer={statusOpen ? currentCustomer : null}
            onClose={() => setStatusOpen(false)}
            onSaved={(updated) => {
              setStatusOpen(false);
              setProfile((current) =>
                current ? { ...current, customer: updated } : current,
              );
              onUpdated(updated);
            }}
          />
          <MergeCustomerModal
            source={mergeOpen ? currentCustomer : null}
            onClose={() => setMergeOpen(false)}
            onMerged={(updated) => {
              setMergeOpen(false);
              setProfile(null);
              onUpdated(updated);
            }}
          />
        </div>
      ) : null}
    </Modal>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-extrabold text-slate-900">{value}</p>
    </Card>
  );
}

function CustomerStatusModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: CustomerDto | null;
  onClose(): void;
  onSaved(customer: CustomerDto): void;
}) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!customer) return;
    setReason("");
    setPin("");
    setError(null);
  }, [customer]);
  const mutation = useApiMutation(
    () =>
      window.gastronomy.setCustomerActive({
        customerId: customer!.id,
        active: !customer!.active,
        reason,
        authorizerPin: pin,
      }),
    { onSuccess: onSaved, onError: (value) => setError(humanError(value)) },
  );
  return (
    <Modal
      open={Boolean(customer)}
      onClose={onClose}
      title={customer?.active ? "Archivar cliente" : "Reactivar cliente"}
      description="La ficha y todo su historial se conservan."
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="Motivo">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </Field>
        <Field label="PIN de autorización">
          <Input
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            type="password"
            inputMode="numeric"
            required
          />
        </Field>
        {error ? (
          <p role="alert" className="text-xs text-rose-600">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              reason.trim().length < 4 || pin.length < 4 || mutation.isPending
            }
          >
            Confirmar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MergeCustomerModal({
  source,
  onClose,
  onMerged,
}: {
  source: CustomerDto | null;
  onClose(): void;
  onMerged(customer: CustomerDto): void;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [results, setResults] = useState<CustomerDto[]>([]);
  const [target, setTarget] = useState<CustomerDto | null>(null);
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!source) return;
    setQuery("");
    setResults([]);
    setTarget(null);
    setReason("");
    setPin("");
    setError(null);
  }, [source]);
  useEffect(() => {
    const value = debouncedQuery.trim();
    if (!source || value.length < 2 || target) return;
    let current = true;
    void window.gastronomy
      .searchCustomersPage({
        query: value,
        page: 1,
        pageSize: 8,
        status: "ACTIVE",
      })
      .then((page) => {
        if (current)
          setResults(page.items.filter((item) => item.id !== source.id));
      })
      .catch((value) => current && setError(humanError(value)));
    return () => {
      current = false;
    };
  }, [debouncedQuery, source, target]);
  const mutation = useApiMutation(
    () =>
      window.gastronomy.mergeCustomers({
        sourceCustomerId: source!.id,
        targetCustomerId: target!.id,
        reason,
        authorizerPin: pin,
      }),
    { onSuccess: onMerged, onError: (value) => setError(humanError(value)) },
  );
  return (
    <Modal
      open={Boolean(source)}
      onClose={onClose}
      title="Fusionar ficha duplicada"
      description="Los pedidos, direcciones, etiquetas y preferencias pasan a la ficha receptora. La ficha de origen queda archivada y auditable."
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Origen: <b>{source?.name}</b> · esta ficha quedará archivada.
        </div>
        <Field
          label="Buscar ficha receptora"
          hint="La búsqueda comienza después de 0,1 segundos."
        >
          <Input
            value={target ? target.name : query}
            onChange={(event) => {
              setTarget(null);
              setQuery(event.target.value);
            }}
            placeholder="Nombre o teléfono"
          />
        </Field>
        {!target && results.length ? (
          <div className="max-h-40 overflow-auto rounded-lg border border-slate-200 p-1">
            {results.map((customer) => (
              <button
                key={customer.id}
                type="button"
                className="focus-ring flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs hover:bg-brand-50"
                onClick={() => {
                  setTarget(customer);
                  setResults([]);
                }}
              >
                <b>{customer.name}</b>
                <span>{customer.phone}</span>
              </button>
            ))}
          </div>
        ) : null}
        {target ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            Receptora: <b>{target.name}</b> · {target.phone} ·{" "}
            {target.addresses.length} direcciones
          </div>
        ) : null}
        <Field label="Motivo de la fusión">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </Field>
        <Field label="PIN de autorización">
          <Input
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            type="password"
            inputMode="numeric"
            required
          />
        </Field>
        {error ? (
          <p role="alert" className="text-xs text-rose-600">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              !target ||
              reason.trim().length < 4 ||
              pin.length < 4 ||
              mutation.isPending
            }
          >
            Fusionar en ficha receptora
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LegacyCustomerProfileModal({
  customer,
  orders,
  onClose,
  onEdit,
}: {
  customer: CustomerDto | null;
  orders: BootstrapDto["orders"];
  onClose(): void;
  onEdit(): void;
}) {
  const metricOrders = orders.filter(
    (order) => order.operationalStatus !== "CANCELLED",
  );
  const paidMinor = metricOrders.reduce(
    (total, order) => total + order.paidMinor,
    0,
  );
  const totalMinor = metricOrders.reduce(
    (total, order) => total + order.totalMinor,
    0,
  );
  const pending = orders.filter(
    (order) => !["DELIVERED", "CANCELLED"].includes(order.operationalStatus),
  ).length;
  return (
    <Modal
      open={Boolean(customer)}
      onClose={onClose}
      width="max-w-3xl"
      title={customer ? `Ficha · ${customer.name}` : "Ficha de cliente"}
      description="Datos de contacto, direcciones y actividad vinculada disponible en este equipo."
    >
      {customer ? (
        <div className="space-y-4">
          <section
            aria-label="Resumen del cliente"
            className="grid gap-2 sm:grid-cols-4"
          >
            <Card className="p-3 sm:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Contacto
              </p>
              <p className="mt-1 text-sm font-extrabold text-slate-900">
                {customer.name}
              </p>
              <a
                className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline"
                href={`tel:${customer.phone}`}
              >
                <Phone size={13} /> {customer.phone}
              </a>
            </Card>
            <Card className="p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Pedidos
              </p>
              <p className="mt-1 text-xl font-extrabold">
                {metricOrders.length}
              </p>
              <p className="text-[10px] text-slate-500">
                {pending} pendiente{pending === 1 ? "" : "s"}
              </p>
            </Card>
            <Card className="p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Cobrado
              </p>
              <p className="mt-1 text-sm font-extrabold">
                {formatMoney(paidMinor)}
              </p>
              <p className="text-[10px] text-slate-500">
                sobre {formatMoney(totalMinor)}
              </p>
            </Card>
          </section>

          <section
            aria-labelledby="customer-addresses-title"
            className="rounded-xl border border-slate-200 p-3"
          >
            <h3
              id="customer-addresses-title"
              className="text-xs font-extrabold text-slate-700"
            >
              Direcciones guardadas
            </h3>
            {customer.addresses.length ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {customer.addresses.map((address, index) => (
                  <article
                    key={address.id}
                    className="rounded-lg bg-slate-50 p-3 text-xs"
                  >
                    <p className="font-extrabold text-slate-700">
                      {addressDisplayLabel(address.label, index)}
                    </p>
                    <p className="mt-1 text-slate-600">{address.address}</p>
                    {address.notes ? (
                      <p className="mt-1 text-[10px] text-slate-500">
                        {address.notes}
                      </p>
                    ) : null}
                    <p className="mt-2 font-bold text-brand-700">
                      Envío habitual: {formatMoney(address.deliveryFeeMinor)}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                No tiene direcciones guardadas.
              </p>
            )}
          </section>

          {customer.notes ? (
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-xs font-extrabold text-slate-700">Notas</h3>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                {customer.notes}
              </p>
            </section>
          ) : null}

          <section aria-labelledby="customer-history-title">
            <div className="flex items-center justify-between gap-2">
              <h3
                id="customer-history-title"
                className="text-xs font-extrabold text-slate-700"
              >
                Historial reciente
              </h3>
              <span className="text-[10px] text-slate-400">
                {orders.length} registro{orders.length === 1 ? "" : "s"}
              </span>
            </div>
            {orders.length ? (
              <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-slate-200">
                <table className="dn-table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Canal</th>
                      <th>Estado</th>
                      <th>Pago</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <b>#{order.number}</b>
                          <span className="block text-[9px] text-slate-400">
                            {new Date(order.createdAt).toLocaleDateString(
                              "es-AR",
                            )}{" "}
                            · {formatTime(order.createdAt)}
                          </span>
                        </td>
                        <td>{typeLabels[order.type]}</td>
                        <td>
                          {order.lifecycleStatus === "DRAFT"
                            ? "Borrador"
                            : statusLabels[order.operationalStatus]}
                        </td>
                        <td>{paymentStatusLabels[order.paymentStatus]}</td>
                        <td className="text-right font-bold">
                          {formatMoney(order.totalMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-400">
                Todavía no hay pedidos vinculados a esta ficha.
              </div>
            )}
          </section>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            <Button type="button" onClick={onEdit}>
              <PencilSimple size={15} /> Editar datos
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
