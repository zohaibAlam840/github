"use client";

/*
 * Gateway onboarding wizard — the 3 manual steps (add gateway, ping to
 * verify, wire up valves) as one guided flow instead of hopping between
 * the Gateways and Buildings screens. Matters most when onboarding many
 * TRBs at once, which is the whole point of getting to 500-valve scale.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { normalizePhone, phoneProblem } from "@/lib/phone";
import type { Building, Gateway, PingResult, Unit } from "@/lib/types";
import { AdminOnly } from "@/components/AdminOnly";
import { Button, Card } from "@/components/ui";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconCheck, IconRadio, IconSpinner, IconValve } from "@/components/icons";

type Step = 1 | 2 | 3 | 4;

export default function GatewayWizardPage() {
  return (
    <AdminOnly>
      <WizardScreen />
    </AdminOnly>
  );
}

function WizardScreen() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [wiredCount, setWiredCount] = useState(0);

  const steps = [
    { n: 1, label: t("wizard.step1") },
    { n: 2, label: t("wizard.step2") },
    { n: 3, label: t("wizard.step3") },
  ] as const;

  return (
    <div className="max-w-2xl space-y-6">
      <Breadcrumb
        items={[
          { label: t("nav.gateways"), href: "/gateways" },
          { label: t("wizard.title") },
        ]}
      />

      <h1 className="text-lg font-semibold text-ink">{t("wizard.title")}</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.n} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                step > s.n
                  ? "bg-good text-white"
                  : step === s.n
                    ? "bg-brand text-white"
                    : "border border-edge text-ink-3"
              }`}
            >
              {step > s.n ? <IconCheck size={13} /> : s.n}
            </div>
            <span
              className={`text-xs ${step === s.n ? "font-medium text-ink" : "text-ink-3"}`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="h-px flex-1 bg-hairline" />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <StepAddGateway
          onCreated={(g) => {
            setGateway(g);
            setStep(2);
          }}
        />
      )}
      {step === 2 && gateway && (
        <StepVerify gateway={gateway} onDone={() => setStep(3)} />
      )}
      {step === 3 && gateway && (
        <StepWireValves
          gateway={gateway}
          onValveAdded={() => setWiredCount((c) => c + 1)}
          onDone={() => setStep(4)}
        />
      )}
      {step === 4 && gateway && <StepDone gateway={gateway} wiredCount={wiredCount} />}
    </div>
  );
}

/* ================= step 1: add gateway ================= */

function StepAddGateway({ onCreated }: { onCreated: (g: Gateway) => void }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [sim, setSim] = useState("");
  const simProblem = sim.trim() ? phoneProblem(normalizePhone(sim)) : null;
  const [authPassword, setAuthPassword] = useState("");
  // One output, always — see the Gateways screen for the reasoning.
  const outputs = 1 as const;
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !sim.trim()) return;
    setSaving(true);
    try {
      const g = await api.gateways.create(
        label.trim(),
        normalizePhone(sim),
        outputs,
        authPassword.trim() || null
      );
      onCreated(g);
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand";

  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-ink-3">{t("wizard.step1Hint")}</p>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">
            {t("gateways.label")}
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="GW-SADD-04"
            className={inputCls}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">
            {t("gateways.sim")}
          </span>
          <input
            value={sim}
            onChange={(e) => setSim(e.target.value)}
            onBlur={() => setSim((v) => normalizePhone(v))}
            aria-invalid={simProblem !== null}
            placeholder="+9745xxxxxxx"
            dir="ltr"
            className={`${inputCls} font-mono`}
            required
          />
          {/* A warning, not a block — see phoneProblem(). The typo it exists
              to catch costs a real SMS and then looks like a dead gateway. */}
          {simProblem && (
            <p className="mt-1.5 text-xs leading-relaxed text-warn">
              {t(`gateways.sim_${simProblem}`, { number: normalizePhone(sim) })}
            </p>
          )}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">
            {t("gateways.authPasswordPlaceholder")}
          </span>
          <input
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            type="password"
            autoComplete="off"
            dir="ltr"
            title={t("gateways.authPasswordHint")}
            className={`${inputCls} font-mono`}
          />
        </label>
        <Button type="submit" disabled={saving} className="w-full">
          {saving && <IconSpinner size={14} />}
          {t("wizard.next")}
        </Button>
      </form>
    </Card>
  );
}

/* ================= step 2: verify (ping) ================= */

function StepVerify({ gateway, onDone }: { gateway: Gateway; onDone: () => void }) {
  const { t } = useTranslation();
  const [pinging, setPinging] = useState(false);
  const [result, setResult] = useState<PingResult | null>(null);

  async function ping() {
    setPinging(true);
    setResult(null);
    try {
      setResult(await api.gateways.ping(gateway.id));
    } finally {
      setPinging(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-ink-3">{t("gateways.pingHint")}</p>
      <div className="flex items-center gap-3 rounded-lg border border-edge px-4 py-3">
        <IconRadio size={16} className="text-brand" />
        <span className="flex-1 font-medium text-ink">{gateway.label}</span>
        <span className="font-mono text-xs text-ink-3" dir="ltr">
          {gateway.simNumber}
        </span>
      </div>

      <Button variant="ghost" disabled={pinging} onClick={ping} className="w-full">
        {pinging ? <IconSpinner size={14} /> : <IconRadio size={14} className="text-brand" />}
        {pinging ? t("gateways.pinging") : t("gateways.ping")}
      </Button>

      {result && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-sm ${
            result.ok
              ? "border-good/40 bg-good/10 text-good-text"
              : "border-critical/40 bg-critical/10 text-critical"
          }`}
        >
          {result.ok
            ? t("gateways.pingOk", { ms: result.roundTripMs, reply: result.replyText })
            : t("gateways.pingFail")}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onDone} className="flex-1">
          {t("wizard.skipVerify")}
        </Button>
        <Button onClick={onDone} disabled={!result?.ok} className="flex-1">
          {t("wizard.next")}
        </Button>
      </div>
    </Card>
  );
}

/* ================= step 3: wire valves ================= */

function StepWireValves({
  gateway,
  onValveAdded,
  onDone,
}: {
  gateway: Gateway;
  onValveAdded: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [buildingId, setBuildingId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [newBuildingName, setNewBuildingName] = useState("");
  const [newUnitName, setNewUnitName] = useState("");
  const [valveCode, setValveCode] = useState("");
  const [output, setOutput] = useState<1 | 2>(1);
  const [added, setAdded] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.buildings.list().then((list) => {
      setBuildings(list);
      if (list.length > 0) setBuildingId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (buildingId === null) {
      setUnits([]);
      setUnitId(null);
      return;
    }
    void api.units.listByBuilding(buildingId).then((list) => {
      setUnits(list);
      setUnitId(list[0]?.id ?? null);
    });
  }, [buildingId]);

  async function addBuilding() {
    if (!newBuildingName.trim()) return;
    const b = await api.buildings.create(newBuildingName.trim(), "");
    setBuildings((prev) => [...prev, b]);
    setBuildingId(b.id);
    setNewBuildingName("");
  }

  async function addUnit() {
    if (!newUnitName.trim() || buildingId === null) return;
    const u = await api.units.create(buildingId, newUnitName.trim());
    setUnits((prev) => [...prev, u]);
    setUnitId(u.id);
    setNewUnitName("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valveCode.trim() || unitId === null) return;
    setSaving(true);
    try {
      await api.valves.create(unitId, valveCode.trim(), gateway.id, output);
      setValveCode("");
      setAdded((n) => n + 1);
      onValveAdded();
    } finally {
      setSaving(false);
    }
  }

  const selectCls =
    "w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand";

  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-ink-3">
        {t("wizard.step3Hint", { label: gateway.label, outputs: gateway.numOutputs })}
      </p>

      {added > 0 && (
        <div className="rounded-lg border border-good/40 bg-good/10 px-4 py-2.5 text-sm text-good-text">
          {t("wizard.valvesAdded", { count: added })}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">
            {t("buildings.list")}
          </span>
          {buildings.length > 0 ? (
            <select
              value={buildingId ?? ""}
              onChange={(e) => setBuildingId(Number(e.target.value))}
              className={selectCls}
            >
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-ink-3">{t("wizard.noBuildingsYet")}</p>
          )}
          <div className="mt-2 flex gap-2">
            <input
              value={newBuildingName}
              onChange={(e) => setNewBuildingName(e.target.value)}
              placeholder={t("wizard.newBuilding")}
              className="min-w-0 flex-1 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand"
            />
            <Button
              type="button"
              variant="ghost"
              className="!px-3 !py-1.5 !text-xs"
              onClick={addBuilding}
            >
              {t("buildings.add")}
            </Button>
          </div>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">
            {t("buildings.addUnit")}
          </span>
          {units.length > 0 ? (
            <select
              value={unitId ?? ""}
              onChange={(e) => setUnitId(Number(e.target.value))}
              className={selectCls}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-ink-3">{t("buildings.noUnits")}</p>
          )}
          <div className="mt-2 flex gap-2">
            <input
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              placeholder={t("buildings.unitName")}
              className="min-w-0 flex-1 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand"
              disabled={buildingId === null}
            />
            <Button
              type="button"
              variant="ghost"
              className="!px-3 !py-1.5 !text-xs"
              onClick={addUnit}
              disabled={buildingId === null}
            >
              {t("buildings.add")}
            </Button>
          </div>
        </label>

        <div className="flex gap-3">
          <label className="flex-1">
            <span className="mb-1.5 block text-sm font-medium text-ink-2">
              {t("buildings.valveCode")}
            </span>
            <input
              value={valveCode}
              onChange={(e) => setValveCode(e.target.value)}
              placeholder="SN0011"
              className={selectCls}
              required
            />
          </label>
          <label className="w-24">
            <span className="mb-1.5 block text-sm font-medium text-ink-2">
              {t("buildings.output")}
            </span>
            <select
              value={output}
              onChange={(e) => setOutput(Number(e.target.value) as 1 | 2)}
              className={selectCls}
            >
              {Array.from({ length: gateway.numOutputs }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  V{n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Button
          type="submit"
          variant="ghost"
          disabled={saving || unitId === null}
          className="w-full"
        >
          {saving ? <IconSpinner size={14} /> : <IconValve size={14} />}
          {t("wizard.addAnotherValve")}
        </Button>
      </form>

      <Button onClick={onDone} className="w-full">
        {t("wizard.finish")}
      </Button>
    </Card>
  );
}

/* ================= step 4: done ================= */

function StepDone({ gateway, wiredCount }: { gateway: Gateway; wiredCount: number }) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <div className="flex h-14 w-14 animate-pop-in items-center justify-center rounded-full border-2 border-good bg-good/10">
        <IconCheck size={26} className="text-good" />
      </div>
      <h2 className="text-base font-semibold text-ink">{t("wizard.done")}</h2>
      <p className="text-sm text-ink-3">
        {t("wizard.doneHint", { label: gateway.label, count: wiredCount })}
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => router.push("/gateways")}>
          {t("nav.gateways")}
        </Button>
        <Button onClick={() => router.push(`/gateways/detail?id=${gateway.id}`)}>
          {t("wizard.viewGateway")}
        </Button>
      </div>
    </Card>
  );
}
