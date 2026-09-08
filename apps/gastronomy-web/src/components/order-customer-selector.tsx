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
    if (!props.open) return;
    setQuery("");
    setSuggestions([]);
    setActiveIndex(0);
    setListOpen(false);
    setSearching(false);
    setCreateOpen(false);
    setSelectedCustomer(null);
    setSearchError(null);
  }, [props.open, props.type]);

  useEffect(() => {
    if (!props.open || !props.customerId || !props.phone.trim()) return;
    const request = ++hydrationRequestRef.current;
    window.gastronomy.searchCustomers(props.phone).then((customers) => {
      if (request !== hydrationRequestRef.current) return;
      const customer = customers.find(
        (candidate) => candidate.id === props.customerId,
      );
      if (!customer) return;
      const selectedAddress =
        customer.addresses.find(
          (candidate) => candidate.address === props.address,
        ) ?? (!props.address.trim() ? customer.addresses[0] : undefined);
      setSelectedCustomer(customer);
      props.setCustomerAddressId(selectedAddress?.id ?? null);
      if (!props.address.trim() && selectedAddress) {
        props.setAddress(selectedAddress.address);
        props.setDeliveryFee(
          String(selectedAddress.deliveryFeeMinor / 100).replace(".", ","),
        );
      }
      setQuery("");
    });
    return () => {
      hydrationRequestRef.current += 1;
    };
  }, [props.open, props.customerId, props.phone]);

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
    setQuery("");
    setSuggestions([]);
    setListOpen(false);
  };

  const clearSelection = () => {
    props.setCustomerId(null);
    props.setCustomerAddressId(null);
    setSelectedCustomer(null);
  };
  const waiting = query.trim() !== debouncedQuery.trim();

  const invalidateSelectedCustomer = () => {
    if (!props.customerId && !selectedCustomer) return;
    clearSelection();
    props.setName("");
    props.setPhone("");
    props.setAddress("");
    props.setDeliveryFee("0");
  };

  const resolvePendingSearch = async () => {
    const value = query.trim();
    if (!value) return false;
    const results = await searchCustomers(value);
    const first = results?.[0];
    if (!first) return false;
    selectCustomer(first);
    window.requestAnimationFrame(() => phoneRef.current?.focus());
    return true;
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <Field
            label="Buscar cliente"
            hint="Escribí nombre o teléfono. La búsqueda comienza después de 0,1 segundos."
          >
            <div className="relative">
              <MagnifyingGlass
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={16}
              />
              <Input
                ref={searchInputRef}
                autoFocus
                value={query}
                onChange={(event) => {
                  hydrationRequestRef.current += 1;
                  invalidateSelectedCustomer();
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
                }}
                onBlur={() => {
                  searchFocusedRef.current = false;
                  searchRequestRef.current += 1;
                  setSearching(false);
                  window.setTimeout(() => setListOpen(false), 120);
                }}
                onKeyDown={(event) => {
                  if (
                    (event.key === "Enter" ||
                      (event.key === "Tab" && !event.shiftKey)) &&
                    (waiting || searching)
                  ) {
                    event.preventDefault();
                    void resolvePendingSearch();
                    return;
                  }
                  if (
                    (event.key === "ArrowDown" || event.key === "ArrowUp") &&
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
                    (event.key === "Enter" || event.key === "Tab") &&
                    listOpen &&
                    suggestions.length
                  ) {
                    event.preventDefault();
                    selectCustomer(suggestions[activeIndex] ?? suggestions[0]!);
                    window.requestAnimationFrame(() =>
                      phoneRef.current?.focus(),
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
                placeholder={
                  selectedCustomer
                    ? `${selectedCustomer.name} seleccionado · buscá para cambiar`
                    : "Ej.: Ana o 11 4444"
                }
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
                      aria-selected={index === activeIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectCustomer(customer)}
                      className={cn(
                        "block w-full rounded-lg px-3 py-2 text-left transition",
                        index === activeIndex
                          ? "bg-brand-50 text-brand-900"
                          : "text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      <strong className="block text-xs">{customer.name}</strong>
                      <span className="text-[10px] text-slate-500">
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
              debouncedQuery.trim() &&
              !waiting &&
              !searching &&
              !selectedCustomer &&
              !suggestions.length ? (
                <div className="absolute inset-x-0 top-[calc(100%+4px)] z-40 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500 shadow-lg">
                  No encontramos coincidencias. Podés crear el cliente sin salir
                  del pedido.
                </div>
              ) : null}
            </div>
          </Field>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setCreateOpen(true)}
          disabled={Boolean(props.customerId)}
          title={
            props.customerId
              ? "Ya hay un cliente vinculado; buscá otro para cambiarlo."
              : undefined
          }
        >
          <Plus size={16} />
          {props.customerId ? "Cliente ya vinculado" : "Crear cliente"}
        </Button>
      </div>
      {waiting || searching ? (
        <p className="text-[10px] font-semibold text-brand-700">
          {waiting ? "Esperando para buscar…" : "Buscando clientes…"}
        </p>
      ) : null}
      {props.customerId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[10px] font-bold text-emerald-800">
          <span className="flex items-center gap-1">
            <AddressBook size={14} />
            {selectedCustomer?.name ?? "Cliente"} vinculado a la base de datos
          </span>
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
            className="underline hover:text-emerald-950"
          >
            Cambiar cliente
          </button>
        </div>
      ) : null}
      {searchError ? (
        <p className="text-xs text-rose-700">{searchError}</p>
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
      <Field
        label={
          props.type === "DELIVERY" ? "Dirección *" : "Dirección (opcional)"
        }
      >
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
      {props.type === "DELIVERY" &&
      selectedCustomer &&
      selectedCustomer.addresses.length > 1 ? (
        <Field
          label="Dirección guardada"
          hint="La dirección principal aparece seleccionada primero."
        >
          <Select
            value={props.customerAddressId ?? ""}
            onChange={(event) => {
              const selected = selectedCustomer.addresses.find(
                (address) => address.id === event.target.value,
              );
              if (!selected) return;
              props.setCustomerAddressId(selected.id);
              props.setAddress(selected.address);
              props.setDeliveryFee(
                String(selected.deliveryFeeMinor / 100).replace(".", ","),
              );
            }}
          >
            {selectedCustomer.addresses.map((address, index) => (
              <option key={address.id} value={address.id}>
                {index === 0 ? "Principal" : address.label} · {address.address}
                {` · Envío ${formatMoney(address.deliveryFeeMinor)}`}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <p className="text-[10px] font-semibold text-slate-500">
        {props.type === "DELIVERY"
          ? "* Nombre, teléfono y dirección son obligatorios para continuar."
          : "* Nombre y teléfono son obligatorios. La dirección es opcional para retirar."}
      </p>
      {props.customerId &&
      selectedCustomer &&
      (props.name.trim() !== selectedCustomer.name ||
        props.phone.trim() !== selectedCustomer.phone ||
        !selectedCustomer.addresses.some(
          (item) => item.address === props.address.trim(),
        )) ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-[10px] font-semibold text-sky-800">
          Los datos editados se usarán sólo en este pedido. La ficha del cliente
          sigue vinculada y no se modifica automáticamente.
        </p>
      ) : null}
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
    if (!open) return;
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
      onClose={onClose}
      title="Crear cliente sin salir del pedido"
      description="Al guardar, queda disponible en la base de clientes y seleccionado en este pedido."
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const deliveryFeeMinor = parseMoneyInput(fee);
          const addressRequired = type === "DELIVERY";
          if (
            !name.trim() ||
            name.trim().length < 2 ||
            phone.replace(/\D/g, "").length < 6 ||
            (addressRequired && !address.trim()) ||
            deliveryFeeMinor == null ||
            mutation.isPending
          )
            return;
          mutation.mutate({
            name,
            phone,
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
        {error ? (
          <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
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
              !name.trim() ||
              !phone.trim() ||
              (type === "DELIVERY" && !address.trim()) ||
              parseMoneyInput(fee) == null ||
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
