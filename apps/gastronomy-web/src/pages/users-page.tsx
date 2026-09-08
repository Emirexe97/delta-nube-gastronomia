import { useEffect, useState } from "react";
import type { BootstrapDto, UserDto } from "@gastronomy/contracts";
import { PencilSimple, Plus, Trash, UsersThree } from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
} from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { humanError } from "../lib";

const roles = [
  ["ADMIN", "Administrador"],
  ["MANAGER", "Supervisor"],
  ["CASHIER", "Cajero"],
  ["WAITER", "Mozo"],
] as const;
type RoleCode = (typeof roles)[number][0];

function firstAvailableStaffNumber(users: UserDto[]) {
  const used = new Set(users.map((user) => user.staffNumber));
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

export function UsersPage({ data }: { data: BootstrapDto }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);
  return (
    <div className="panel-enter mx-auto max-w-[1250px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Usuarios y permisos</h2>
          <p className="text-xs text-slate-400">
            Roles reutilizables, capacidades y número rápido para salón
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Nuevo usuario
        </Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="dn-table min-w-[640px]">
          <thead>
            <tr>
              <th>N.º</th>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Permisos</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.users
              .filter((user) => user.roleCode !== "DELIVERY_DRIVER")
              .map((user) => (
                <tr key={user.id}>
                  <td className="font-mono text-xs font-extrabold text-brand-700">
                    #{user.staffNumber}
                  </td>
                  <td className="font-bold text-slate-900">{user.fullName}</td>
                  <td>
                    <Badge tone="orange">{user.roleName}</Badge>
                  </td>
                  <td>
                    <span className="text-xs font-semibold">
                      {user.permissions.length}
                    </span>
                    <p className="max-w-[420px] truncate text-[10px] text-slate-400">
                      {user.permissions.join(" · ") ||
                        "Sin capacidades operativas"}
                    </p>
                  </td>
                  <td>
                    <Badge tone={user.active ? "green" : "slate"}>
                      {user.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => setEditing(user)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-700"
                      aria-label={`Editar ${user.fullName}`}
                    >
                      <PencilSimple />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
      <CreateUserModal
        open={createOpen}
        users={data.users}
        onClose={() => setCreateOpen(false)}
      />
      <EditUserModal user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CreateUserModal({
  open,
  users,
  onClose,
}: {
  open: boolean;
  users: UserDto[];
  onClose(): void;
}) {
  const [staffNumber, setStaffNumber] = useState("");
  const [name, setName] = useState("");
  const [roleCode, setRoleCode] = useState<RoleCode>("WAITER");
  const [pin, setPin] = useState("");
  const [authorizerPin, setAuthorizerPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setStaffNumber(String(firstAvailableStaffNumber(users)));
      setError(null);
    }
  }, [open, users]);
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.createUser>[0]) =>
      window.gastronomy.createUser(input),
    {
      onSuccess: () => {
        setStaffNumber("");
        setName("");
        setPin("");
        setAuthorizerPin("");
        onClose();
      },
      onError: (value) => setError(humanError(value)),
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo usuario"
      description="El autorizante debe poseer users.manage"
    >
      <div className="grid gap-4">
        <Field label="Número de usuario">
          <Input
            inputMode="numeric"
            value={staffNumber}
            onChange={(event) =>
              setStaffNumber(event.target.value.replace(/\D/g, ""))
            }
          />
        </Field>
        <Field label="Nombre completo">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Rol">
          <Select
            value={roleCode}
            onChange={(event) => setRoleCode(event.target.value as RoleCode)}
          >
            {roles.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="PIN del usuario">
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              maxLength={8}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, ""))
              }
            />
          </Field>
          <Field label="PIN de autorización">
            <Input
              type="password"
              inputMode="numeric"
              value={authorizerPin}
              maxLength={8}
              onChange={(event) =>
                setAuthorizerPin(event.target.value.replace(/\D/g, ""))
              }
            />
          </Field>
        </div>
        {error ? (
          <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={
              !name.trim() ||
              !Number.isSafeInteger(Number(staffNumber)) ||
              Number(staffNumber) <= 0 ||
              pin.length < 4 ||
              authorizerPin.length < 4 ||
              mutation.isPending
            }
            onClick={() =>
              mutation.mutate({
                staffNumber: Number(staffNumber),
                fullName: name,
                roleCode,
                pin,
                authorizerPin,
              })
            }
          >
            <UsersThree />
            Crear usuario
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EditUserModal({
  user,
  onClose,
}: {
  user: UserDto | null;
  onClose(): void;
}) {
  const [roleCode, setRoleCode] = useState<RoleCode>("WAITER");
  const [staffNumber, setStaffNumber] = useState("");
  const [active, setActive] = useState(true);
  const [newPin, setNewPin] = useState("");
  const [reason, setReason] = useState("");
  const [authorizerPin, setAuthorizerPin] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (user) {
      setRoleCode(user.roleCode as RoleCode);
      setStaffNumber(String(user.staffNumber));
      setActive(user.active);
      setNewPin("");
      setReason("");
      setAuthorizerPin("");
      setDeleteConfirmation("");
      setDeleteOpen(false);
      setError(null);
    }
  }, [user]);
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.updateUser>[0]) =>
      window.gastronomy.updateUser(input),
    { onSuccess: onClose, onError: (value) => setError(humanError(value)) },
  );
  const deleteMutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.deleteUser>[0]) =>
      window.gastronomy.deleteUser(input),
    { onSuccess: onClose, onError: (value) => setError(humanError(value)) },
  );
  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title={`Editar ${user?.fullName ?? "usuario"}`}
      description="Los cambios quedan auditados"
    >
      <div className="grid gap-4">
        <Field label="Número de usuario">
          <Input
            inputMode="numeric"
            value={staffNumber}
            onChange={(event) =>
              setStaffNumber(event.target.value.replace(/\D/g, ""))
            }
          />
        </Field>
        <Field label="Rol">
          <Select
            value={roleCode}
            onChange={(event) => setRoleCode(event.target.value as RoleCode)}
          >
            {roles.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-xs font-semibold">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            className="accent-brand-600"
          />
          Usuario activo
        </label>
        <Field label="Nuevo PIN (opcional)">
          <Input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={newPin}
            onChange={(event) =>
              setNewPin(event.target.value.replace(/\D/g, ""))
            }
          />
        </Field>
        <Field label="Motivo">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Cambio de función, baja, rotación de PIN…"
          />
        </Field>
        <Field label="PIN de autorización">
          <Input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={authorizerPin}
            onChange={(event) =>
              setAuthorizerPin(event.target.value.replace(/\D/g, ""))
            }
          />
        </Field>
        {error ? (
          <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        {deleteOpen && user?.id !== "user-admin" ? (
          <div className="grid gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs font-semibold text-rose-700">
              Escribí el número {user?.staffNumber} para confirmar la
              eliminación. Si tiene historial, se bloqueará y podrás marcarlo
              inactivo.
            </p>
            <Input
              value={deleteConfirmation}
              inputMode="numeric"
              onChange={(event) =>
                setDeleteConfirmation(event.target.value.replace(/\D/g, ""))
              }
              aria-label="Confirmación número de usuario"
            />
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          {user?.id !== "user-admin" ? (
            <Button
              variant="danger"
              disabled={
                deleteMutation.isPending ||
                (deleteOpen &&
                  (deleteConfirmation !== String(user?.staffNumber) ||
                    !reason.trim() ||
                    authorizerPin.length < 4))
              }
              onClick={() => {
                if (!deleteOpen) {
                  setDeleteOpen(true);
                  setDeleteConfirmation("");
                  setError(null);
                  return;
                }
                deleteMutation.mutate({
                  userId: user!.id,
                  reason,
                  authorizerPin,
                });
              }}
            >
              <Trash />
              {deleteOpen ? "Confirmar eliminación" : "Eliminar usuario"}
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={
              !user ||
              !Number.isSafeInteger(Number(staffNumber)) ||
              Number(staffNumber) <= 0 ||
              !reason.trim() ||
              authorizerPin.length < 4 ||
              (newPin.length > 0 && newPin.length < 4) ||
              mutation.isPending
            }
            onClick={() =>
              mutation.mutate({
                userId: user!.id,
                staffNumber: Number(staffNumber),
                roleCode,
                active,
                newPin: newPin || null,
                reason,
                authorizerPin,
              })
            }
          >
            Guardar cambios
          </Button>
        </div>
      </div>
    </Modal>
  );
}
