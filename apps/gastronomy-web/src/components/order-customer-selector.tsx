import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomerDto, OrderType } from "@gastronomy/contracts";
import { AddressBook, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { Button, Field, Input, Modal, Select, cn } from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { formatMoney, humanError, parseMoneyInput } from "../lib";

type Props = {
  open: boolean;
  type: OrderType;
  customerId: string | null;
  name: string;
  phone: string;
  address: string;
  customerAddressId: string | null;
  deliveryFee: string;
  setName(value: string): void;
  setPhone(value: string): void;
  setAddress(value: string): void;
  setCustomerId(value: string | null): void;
  setCustomerAddressId(value: string | null): void;
  setDeliveryFee(value: string): void;
};

export function OrderCustomerSelector(props: Props) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [suggestions, setSuggestions] = useState<CustomerDto[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDto | null>(
    null,
  );
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRequestRef = useRef(0);
  const hydrationRequestRef = useRef(0);
  const searchFocusedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const sortSuggestions = useCallback(
    (results: CustomerDto[], query: string) => {
      const normalized = query
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLocaleLowerCase("es-AR");
      const digits = query.replace(/\D/g, "");
      const hasLetters = /[a-záéíóúñ]/i.test(query);
      return results
        .filter((customer) => {
          const text = `${customer.name} ${customer.phone} ${customer.addresses
            .map((address) => `${address.address} ${address.notes ?? ""}`)
            .join(" ")}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase("es-AR");
          if (hasLetters) return text.includes(normalized);
          if (digits) return customer.phone.replace(/\D/g, "").includes(digits);
          return !normalized || text.includes(normalized);
        })
        .sort((left, right) =>
          left.name.localeCompare(right.name, "es-AR", {
            sensitivity: "base",
          }),
        )
        .slice(0, 8);
    },
    [],
  );

  useEffect(() => {
    // A modality change resets transient search state, not customer identity.
    searchRequestRef.current += 1;
    hydrationRequestRef.current += 1;
    setQuery("");
    setSuggestions([]);
    setActiveIndex(0);
    setListOpen(false);
    setSearching(false);
    setCreateOpen(false);
    setSearchError(null);
    searchFocusedRef.current =
      document.activeElement === searchInputRef.current;
  }, [props.open, props.type]);

  useEffect(() => {
    if (
      !props.open ||
      !props.customerId ||
      (selectedCustomer && selectedCustomer.id !== props.customerId)
    )
      setSelectedCustomer(null);
  }, [props.open, props.customerId, selectedCustomer]);

  useEffect(() => {
    if (!props.open || !props.customerId) return;
    const request = ++hydrationRequestRef.current;
    void window.gastronomy
      .getCustomerProfile({
        customerId: props.customerId,
        page: 1,
        pageSize: 1,
      })
      .then(({ customer }) => {
        const current = latestPropsRef.current;
        if (
          request !== hydrationRequestRef.current ||
          !current.open ||
          current.customerId !== customer.id
        )
          return;
        const address = customer.addresses.find(
          (candidate) => candidate.address.trim() === current.address.trim(),
        );
        setSelectedCustomer(customer);
        // Hydration restores the saved choices, never overwrites typed snapshots.
        current.setCustomerAddressId(address?.id ?? null);
        setSearchError(null);
      })
      .catch(() => {
        if (request === hydrationRequestRef.current)
          setSearchError(
            "No se pudo recuperar la ficha del cliente. Los datos del pedido se conservan.",
          );
      });
    return () => {
      hydrationRequestRef.current += 1;
    };
  }, [props.open, props.type, props.customerId, hydrationAttempt]);

  const searchCustomers = useCallback(
    async (value: string) => {
      const request = ++searchRequestRef.current;
      setSearching(true);
      try {
        const results = await window.gastronomy.searchCustomers(value);
        if (request !== searchRequestRef.current) return null;
        const sorted = sortSuggestions(results, value);
        setSuggestions(sorted);
        setActiveIndex(0);
        setListOpen(searchFocusedRef.current);
        setSearchError(null);
        return sorted;
      } catch (value) {
        if (request !== searchRequestRef.current) return null;
        setSuggestions([]);
        setSearchError(humanError(value));
        return null;
      } finally {
        if (request === searchRequestRef.current) setSearching(false);
      }
    },
    [sortSuggestions],
  );

  useEffect(() => {
    const value = debouncedQuery.trim();
    if (!props.open || selectedCustomer || value.length < 1) {
      searchRequestRef.current += 1;
      setSuggestions([]);
      setSearching(false);
      return;
    }
    void searchCustomers(value);
  }, [debouncedQuery, props.open, searchCustomers, selectedCustomer]);

  const selectCustomer = (customer: CustomerDto) => {
    searchRequestRef.current += 1;
    const primaryAddress = customer.addresses[0];
    props.setCustomerId(customer.id);
    props.setName(customer.name);
    props.setPhone(customer.phone);
    props.setAddress(primaryAddress?.address ?? "");
    props.setCustomerAddressId(primaryAddress?.id ?? null);
    props.setDeliveryFee(
      String((primaryAddress?.deliveryFeeMinor ?? 0) / 100).replace(".", ","),
    );
    setSelectedCustomer(customer);
    setSearching(false);
    searchFocusedRef.current = false;
    window.requestAnimationFrame(() => phoneRef.current?.focus());
    setQuery("");
    setSuggestions([]);
    setListOpen(false);
  };

  const clearSelection = () => {
    searchRequestRef.current += 1;
    hydrationRequestRef.current += 1;
    props.setCustomerId(null);
    props.setCustomerAddressId(null);
    setSelectedCustomer(null);
    setQuery("");
    setSuggestions([]);
    setListOpen(false);
    setSearching(false);
    setSearchError(null);
  };
  const waiting = query.trim() !== debouncedQuery.trim();

  const resolvePendingSearch = async () => {
    const value = query.trim();
    if (!value) return false;
    const results = await searchCustomers(value);
    if (!results?.length) return false;
    if (results.length === 1) selectCustomer(results[0]!);
    else setListOpen(true);
    return results.length === 1;
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <h3 className="text-sm font-bold text-slate-900">Cliente del pedido</h3>
      {props.customerId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-xs font-semibold">
              <AddressBook size={16} />
              Cliente guardado
            </p>
            <strong className="block break-words">
              {selectedCustomer?.name ?? props.name}
            </strong>
            <span className="block text-xs">
              {selectedCustomer?.phone ?? props.phone}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              clearSelection();
              props.setName("");
              props.setPhone("");
              props.setAddress("");
              props.setDeliveryFee("0");
              window.requestAnimationFrame(() =>
                searchInputRef.current?.focus(),
              );
            }}
            className="font-semibold underline"
          >
            Cambiar cliente
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1">
              <Field label="Buscar cliente">
                <div className="relative">
                  <MagnifyingGlass
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    size={16}
                  />
                  <Input
                    ref={searchInputRef}
                    aria-describedby="order-customer-search-hint"
                    autoFocus
                    value={query}
                    onChange={(event) => {
                      hydrationRequestRef.current += 1;
                      searchRequestRef.current += 1;
                      setQuery(event.target.value);
                      setSuggestions([]);
                      setSearching(false);
                      setSearchError(null);
                      setListOpen(true);
                      setActiveIndex(0);
                    }}
                    onFocus={() => {
                      searchFocusedRef.current = true;
                      setListOpen(true);
                      // A blurred pending request is invalidated; refocus retries it.
                      if (query.trim() && !suggestions.length)
                        void searchCustomers(query.trim());
                    }}
                    onBlur={() => {
                      searchFocusedRef.current = false;
                      searchRequestRef.current += 1;
                      setSearching(false);
                      setListOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (waiting || searching)) {
                        event.preventDefault();
                        void resolvePendingSearch();
                        return;
                      }
                      if (
                        (event.key === "ArrowDown" ||
                          event.key === "ArrowUp") &&
                        suggestions.length
                      ) {
                        event.preventDefault();
                        const direction = event.key === "ArrowDown" ? 1 : -1;
                        setActiveIndex(
                          (activeIndex + direction + suggestions.length) %
                            suggestions.length,
                        );
                        setListOpen(true);
                        return;
                      }
                      if (
                        event.key === "Enter" &&
                        listOpen &&
                        suggestions.length
                      ) {
                        event.preventDefault();
                        selectCustomer(
                          suggestions[activeIndex] ?? suggestions[0]!,
                        );
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setListOpen(false);
                      }
                    }}
                    placeholder="Ej.: Ana o 11 4444"
                    className="pl-9"
                    maxLength={120}
                    autoComplete="off"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={listOpen && suggestions.length > 0}
                    aria-controls="order-customer-options"
                    aria-activedescendant={
                      listOpen && suggestions[activeIndex]
                        ? `order-customer-${suggestions[activeIndex]!.id}`
                        : undefined
                    }
                  />
                  {listOpen && suggestions.length ? (
                    <div
                      id="order-customer-options"
                      role="listbox"
                      aria-label="Clientes encontrados"
                      className="absolute inset-x-0 top-[calc(100%+4px)] z-40 max-h-64 overflow-y-auto rounded-xl border border-brand-200 bg-white p-1.5 shadow-xl"
                    >
                      {suggestions.map((customer, index) => (
                        <button
                          id={`order-customer-${customer.id}`}
                          key={customer.id}
                          type="button"
                          role="option"
                          tabIndex={-1}
                          aria-selected={index === activeIndex}
                          onMouseDown={(event) => event.preventDefault()}
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => selectCustomer(customer)}
                          className={cn(
                            "block w-full rounded-lg px-3 py-2 text-left transition",
                            index === activeIndex
                              ? "bg-brand-50 text-brand-900"
                              : "text-slate-700 hover:bg-slate-50",
                          )}
                        >
                          <strong className="block text-xs">
                            {customer.name}
                          </strong>
                          <span className="text-xs text-slate-600">
                            {customer.phone}
                            {customer.addresses[0]?.address
                              ? ` · ${customer.addresses[0].address}`
                              : " · Sin dirección"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {listOpen &&
                  !searchError &&
                  debouncedQuery.trim() &&
                  !waiting &&
                  !searching &&
                  !selectedCustomer &&
                  !suggestions.length ? (
                    <div className="absolute inset-x-0 top-[calc(100%+4px)] z-40 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg">
                      No encontramos coincidencias. Podés completar los datos
                      del pedido sin guardar una ficha.
                    </div>
                  ) : null}
                </div>
              </Field>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={16} />
              Crear cliente
            </Button>
          </div>
          <p id="order-customer-search-hint" className="text-xs text-slate-600">
            Buscá un cliente guardado o completá los datos abajo.
          </p>
          {waiting || searching ? (
            <p className="text-xs font-semibold text-brand-700">
              Buscando clientes…
            </p>
          ) : null}
        </>
      )}
      {searchError ? (
        <div role="alert" className="text-xs text-rose-700">
          <p>{searchError}</p>
          {props.customerId ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setHydrationAttempt((value) => value + 1)}
            >
              Reintentar ficha
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Teléfono *">
          <Input
            ref={phoneRef}
            value={props.phone}
            onChange={(event) => props.setPhone(event.target.value)}
            inputMode="tel"
            maxLength={40}
            placeholder="351…"
            required
          />
        </Field>
        <Field label="Nombre del cliente *">
          <Input
            value={props.name}
            onChange={(event) => props.setName(event.target.value)}
            placeholder="Nombre y apellido"
            maxLength={120}
            required
          />
        </Field>
      </div>
      <p className="text-xs text-slate-600">
        {props.customerId
          ? "Nombre y teléfono editados se aplican sólo a este pedido."
          : "Completá estos datos para el pedido. Crear cliente guarda una ficha para próximas visitas."}
      </p>
      {props.type === "DELIVERY" &&
      selectedCustomer &&
      selectedCustomer.addresses.length > 0 ? (
        <Field label="Dirección guardada" hint="La principal aparece primero.">
          <Select
            value={props.customerAddressId ?? ""}
            onChange={(event) => {
              const selected = selectedCustomer.addresses.find(
                (address) => address.id === event.target.value,
              );
              if (!selected) {
                props.setCustomerAddressId(null);
                return;
              }
              props.setCustomerAddressId(selected.id);
              props.setAddress(selected.address);
              props.setDeliveryFee(
                String(selected.deliveryFeeMinor / 100).replace(".", ","),
              );
            }}
          >
            <option value="">Otra dirección para este pedido</option>
            {selectedCustomer.addresses.map((address, index) => (
              <option key={address.id} value={address.id}>
                {address.label ||
                  (index === 0 ? "Principal" : `Dirección ${index + 1}`)}{" "}
                · {address.address} · Envío{" "}
                {formatMoney(address.deliveryFeeMinor)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {props.type === "DELIVERY" ? (
        <Field label="Dirección *">
          <Input
            value={props.address}
            onChange={(event) => {
              props.setAddress(event.target.value);
              props.setCustomerAddressId(null);
            }}
            placeholder="Calle, número y referencia"
            maxLength={240}
            required={props.type === "DELIVERY"}
          />
        </Field>
      ) : null}
      <p className="text-xs font-semibold text-slate-600">
        * Campos obligatorios.
      </p>
      <CreateCustomerModal
        open={createOpen}
        initialQuery={query}
        initialName={props.name}
        initialPhone={props.phone}
        initialAddress={props.address}
        initialFee={props.deliveryFee}
        type={props.type}
        onClose={() => setCreateOpen(false)}
        onCreated={(customer) => {
          setCreateOpen(false);
          selectCustomer(customer);
        }}
      />
    </section>
  );
}

function CreateCustomerModal({
  open,
  initialQuery,
  initialName,
  initialPhone,
  initialAddress,
  initialFee,
  type,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialQuery: string;
  initialName: string;
  initialPhone: string;
  initialAddress: string;
  initialFee: string;
  type: OrderType;
  onClose(): void;
  onCreated(customer: CustomerDto): void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [fee, setFee] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const wasOpenRef = useRef(false);
  const mutation = useApiMutation(
    async (input: {
      name: string;
      phone: string;
      addresses: Array<{
        label: string;
        address: string;
        deliveryFeeMinor: number;
      }>;
    }) => {
      const matches = await window.gastronomy.searchCustomers(input.phone);
      const normalizeText = (value: string) =>
        value
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toLocaleLowerCase("es-AR");
      const normalizedPhone = input.phone.replace(/\D/g, "");
      const duplicate = matches.find(
        (customer) =>
          normalizeText(customer.name) === normalizeText(input.name) &&
          customer.phone.replace(/\D/g, "") === normalizedPhone,
      );
      if (duplicate)
        throw new Error(
          `Ya existe ${duplicate.name} con ese teléfono. Seleccionalo desde la búsqueda en lugar de duplicarlo.`,
        );
      return window.gastronomy.createCustomer(input);
    },
    { onSuccess: onCreated, onError: (value) => setError(humanError(value)) },
  );

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    const queryLooksLikePhone =
      /^[+\d\s()-]+$/.test(initialQuery.trim()) &&
      initialQuery.replace(/\D/g, "").length >= 6;
    setName(initialName || (queryLooksLikePhone ? "" : initialQuery));
    setPhone(initialPhone || (queryLooksLikePhone ? initialQuery : ""));
    setAddress(initialAddress);
    setFee(initialFee || "0");
    setError(null);
  }, [
    open,
    initialAddress,
    initialFee,
    initialName,
    initialPhone,
    initialQuery,
  ]);

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
      title="Crear cliente sin salir del pedido"
      description="Guardá una ficha y usala en este pedido. Guardar el cliente no crea el pedido."
      closeDisabled={mutation.isPending}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const deliveryFeeMinor =
            type === "DELIVERY" ? parseMoneyInput(fee) : 0;
          const addressRequired = type === "DELIVERY";
          if (
            name.trim().length < 2 ||
            phone.replace(/\D/g, "").length < 6 ||
            (addressRequired && !address.trim()) ||
            deliveryFeeMinor == null ||
            mutation.isPending
          )
            return;
          mutation.mutate({
            name: name.trim(),
            phone: phone.trim(),
            addresses: address.trim()
              ? [
                  {
                    label: "Principal",
                    address: address.trim(),
                    deliveryFeeMinor:
                      type === "DELIVERY" ? deliveryFeeMinor : 0,
                  },
                ]
              : [],
          });
        }}
      >
        <Field label="Nombre">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
        </Field>
        <Field label="Teléfono">
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            maxLength={40}
            required
          />
        </Field>
        <Field
          label={type === "DELIVERY" ? "Dirección" : "Dirección (opcional)"}
        >
          <Input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            required={type === "DELIVERY"}
            placeholder="Calle, número y referencia"
            maxLength={240}
          />
        </Field>
        {type === "DELIVERY" ? (
          <Field
            label="Valor del envío"
            hint="Quedará guardado como valor habitual de esta dirección."
          >
            <Input
              value={fee}
              onChange={(event) => setFee(event.target.value)}
              inputMode="decimal"
              required
            />
          </Field>
        ) : null}
        {error ||
        name.trim().length < 2 ||
        phone.replace(/\D/g, "").length < 6 ||
        (type === "DELIVERY" && !address.trim()) ||
        (type === "DELIVERY" && parseMoneyInput(fee) == null) ? (
          <p role="status" className="text-xs text-slate-600">
            {error ??
              (name.trim().length < 2
                ? "Ingresá un nombre de al menos 2 caracteres."
                : phone.replace(/\D/g, "").length < 6
                  ? "Ingresá un teléfono con al menos 6 dígitos."
                  : type === "DELIVERY" && !address.trim()
                    ? "Ingresá una dirección para el envío."
                    : "Ingresá un valor de envío válido.")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              name.trim().length < 2 ||
              phone.replace(/\D/g, "").length < 6 ||
              (type === "DELIVERY" && !address.trim()) ||
              (type === "DELIVERY" && parseMoneyInput(fee) == null) ||
              mutation.isPending
            }
          >
            Guardar y seleccionar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
