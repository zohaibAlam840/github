"use client";

/*
 * Users — account management (admin only).
 * Admin creates accounts and assigns roles; you cannot delete yourself.
 * Real backend stores bcrypt hashes only — the password field here is
 * write-only and never displayed.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Role, User } from "@/lib/types";
import { AdminOnly } from "@/components/AdminOnly";
import { Button, Card, Field, Modal } from "@/components/ui";
import { IconX } from "@/components/icons";

const ROLES: Role[] = ["admin", "operator", "viewer"];

export default function UsersPage() {
  return (
    <AdminOnly>
      <UsersScreen />
    </AdminOnly>
  );
}

function UsersScreen() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);

  const load = useCallback(async () => {
    setUsers(await api.users.list());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-3xl space-y-4">
      <ChangeMyPasswordCard />
      {resetFor && (
        <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />
      )}
      {error && (
        <div className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-2.5 text-sm text-critical">
          {error}
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-ink-3">
              <th className="px-4 py-2.5 text-start font-medium">{t("users.name")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("users.username")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("users.role")}</th>
              <th className="px-4 py-2.5 text-start font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-ink">
                  {u.name}
                  {me?.id === u.id && (
                    <span className="ms-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
                      {t("users.you")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-2">{u.username}</td>
                <td className="px-4 py-3 text-ink-2">{t(`roles.${u.role}`)}</td>
                <td className="px-4 py-3 text-end">
                  {me?.id !== u.id && (
                    <button
                      onClick={() => setResetFor(u)}
                      className="me-1 rounded px-2 py-1 text-xs text-ink-3 hover:text-brand"
                      title={t("users.resetPasswordHint")}
                    >
                      {t("users.resetPassword")}
                    </button>
                  )}
                  {me?.id !== u.id && (
                    <button
                      onClick={async () => {
                        if (confirm(t("users.confirmDelete"))) {
                          await api.users.remove(u.id);
                          void load();
                        }
                      }}
                      className="rounded p-1 text-ink-3 hover:text-critical"
                      title={t("buildings.delete")}
                    >
                      <IconX size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <AddUserForm
          onAdded={load}
          onError={(code) =>
            setError(code === "USERNAME_TAKEN" ? t("users.usernameTaken") : code)
          }
        />
      </Card>
    </div>
  );
}

function AddUserForm({
  onAdded,
  onError,
}: {
  onAdded: () => void;
  onError: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("operator");

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.users.create(name.trim(), username.trim(), password, role);
      setName("");
      setUsername("");
      setPassword("");
      setRole("operator");
      onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "ERROR");
    }
  }

  const inputCls =
    "rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand";

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 border-t border-hairline p-4"
    >
      <span className="text-xs font-semibold text-ink-2">{t("users.addUser")}</span>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("users.name")}
        className={`${inputCls} min-w-40`}
        required
      />
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder={t("users.username")}
        className={`${inputCls} min-w-32`}
        autoComplete="off"
        required
      />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("users.password")}
        type="password"
        autoComplete="new-password"
        className={`${inputCls} min-w-32`}
        required
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        className={inputCls}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`roles.${r}`)}
          </option>
        ))}
      </select>
      <Button type="submit" className="!px-3 !py-1.5 !text-xs">
        {t("buildings.add")}
      </Button>
    </form>
  );
}

/**
 * Change your own password. Requires the current one, so someone who walks
 * up to an unlocked screen cannot lock the real owner out of a system that
 * controls physical valves.
 */
function ChangeMyPasswordCard() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (!me) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    if (next !== confirmValue) {
      setResult({ ok: false, message: t("users.passwordMismatch") });
      return;
    }
    setBusy(true);
    try {
      await api.users.changePassword(me!.id, next, current);
      setResult({ ok: true, message: t("users.passwordChanged") });
      setCurrent("");
      setNext("");
      setConfirmValue("");
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-ink">{t("users.myPassword")}</h2>
      <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-3">{t("users.myPasswordHint")}</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Field
          label={t("users.currentPassword")}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <Field
          label={t("users.newPassword")}
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <Field
          label={t("users.confirmPassword")}
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={confirmValue}
          onChange={(e) => setConfirmValue(e.target.value)}
          required
        />
        <div className="sm:col-span-3">
          <Button type="submit" disabled={busy}>
            {t("users.changePassword")}
          </Button>
        </div>
      </form>
      {result && (
        <p className={`mt-2 text-xs ${result.ok ? "text-good" : "text-critical"}`}>
          {result.message}
        </p>
      )}
    </Card>
  );
}

/** Admin reset for someone else — no current password, because the point of a reset is that nobody knows it. */
function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useTranslation();
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.users.changePassword(user.id, next);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${t("users.resetPassword")} — ${user.name}`}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-good">{t("users.resetDone", { name: user.name })}</p>
          <p className="text-xs leading-relaxed text-ink-3">{t("users.resetTellThem")}</p>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field
            label={t("users.newPassword")}
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <p className="text-xs leading-relaxed text-ink-3">{t("users.resetHint")}</p>
          {error && <p className="text-xs text-critical">{error}</p>}
          <Button type="submit" disabled={busy}>
            {t("users.resetPassword")}
          </Button>
        </form>
      )}
    </Modal>
  );
}
