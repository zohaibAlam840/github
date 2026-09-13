"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import type { Gateway } from "@/lib/types";
import { Button } from "@/components/ui";

export function AddValveForm({
  unitId,
  gateways,
  onAdded,
}: {
  unitId: number;
  gateways: Gateway[];
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [gatewayId, setGatewayId] = useState<number>(gateways[0]?.id ?? 0);
  const [output, setOutput] = useState<1 | 2>(1);

  const gateway = gateways.find((g) => g.id === gatewayId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !gateway) return;
    // Defense in depth: the output <select>'s onChange below already clamps
    // this, but a stale `output` state from before a gateway switch (e.g.
    // "V2" picked, then swapped to a 1-output gateway without touching the
    // output field again) must never reach a gateway that doesn't have that
    // many outputs — that would create a valve with no real relay behind it.
    const validOutput = Math.min(output, gateway.numOutputs) as 1 | 2;
    await api.valves.create(unitId, code.trim(), gateway.id, validOutput);
    setCode("");
    onAdded();
  }

  const selectCls =
    "rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand";

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 border-b border-hairline bg-hairline/20 px-5 py-3"
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={t("buildings.valveCode")}
        className="min-w-40 flex-1 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand"
        required
      />
      <label className="flex items-center gap-1.5 text-xs text-ink-2">
        {t("buildings.gateway")}
        <select
          value={gatewayId}
          onChange={(e) => {
            const nextId = Number(e.target.value);
            setGatewayId(nextId);
            // A gateway with fewer outputs than the currently-picked V2
            // would otherwise leave the output <select> showing a value
            // with no matching <option> — clamp it here, not just at submit.
            const next = gateways.find((g) => g.id === nextId);
            if (next) setOutput((o) => Math.min(o, next.numOutputs) as 1 | 2);
          }}
          className={selectCls}
        >
          {gateways.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-ink-2">
        {t("buildings.output")}
        <select
          value={output}
          onChange={(e) => setOutput(Number(e.target.value) as 1 | 2)}
          className={selectCls}
        >
          {Array.from({ length: gateway?.numOutputs ?? 1 }, (_, i) => i + 1).map(
            (n) => (
              <option key={n} value={n}>
                V{n}
              </option>
            )
          )}
        </select>
      </label>
      <Button type="submit" className="!px-3 !py-1.5 !text-xs">
        {t("buildings.add")}
      </Button>
    </form>
  );
}
