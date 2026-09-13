"use client";

/*
 * TRB141 Guide — a static reference page, not a data screen. Written from
 * what's actually been bench-confirmed on real hardware (see memory /
 * i2i-CMS-BUILD-BRIEF.md), not just the Teltonika docs — anything not yet
 * verified against real hardware is flagged as such, same honesty rule the
 * rest of this project follows.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui";
import { IconAlert, IconCheck, IconLock, IconRadio, IconValve } from "@/components/icons";

function Callout({
  tone,
  children,
}: {
  tone: "warn" | "good";
  children: ReactNode;
}) {
  const styles =
    tone === "warn"
      ? "border-warn/40 bg-warn/10 text-ink-2"
      : "border-good/40 bg-good/10 text-good-text";
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${styles}`}>
      {tone === "warn" ? (
        <IconAlert size={14} className="mt-0.5 shrink-0 text-warn" />
      ) : (
        <IconCheck size={14} className="mt-0.5 shrink-0 text-good" />
      )}
      <span>{children}</span>
    </div>
  );
}

/**
 * Deliberately a LOGICAL flow (dashboard label -> TRB141 target -> keyword),
 * not a literal physical terminal-pinout drawing. Output 1's physical
 * terminals (3,4,5) are bench-confirmed and mentioned in its note; output
 * 2's are not, and inventing a pinout for it would be exactly the kind of
 * unverified hardware claim this whole page exists to avoid.
 */
function OutputFlow({
  label,
  target,
  keywords,
  status,
  note,
}: {
  label: string;
  target: string;
  keywords: string;
  status: "confirmed" | "unverified";
  note: string;
}) {
  const { t } = useTranslation();
  const confirmed = status === "confirmed";
  return (
    <div
      className={`rounded-lg border p-3.5 ${
        confirmed ? "border-good/30 bg-good/5" : "border-warn/30 bg-warn/5"
      }`}
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-xs" dir="ltr">
        <span className="rounded-md bg-ink px-2 py-1 font-mono font-semibold text-white">
          {label}
        </span>
        <span className="text-ink-3">&rarr;</span>
        <span className="rounded-md border border-edge bg-surface px-2 py-1 text-ink-2">
          {target}
        </span>
        <span className="text-ink-3">&rarr;</span>
        <span className="rounded-md border border-edge bg-surface px-2 py-1 font-mono text-ink-2">
          {keywords}
        </span>
      </div>
      <div
        className={`mb-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          confirmed ? "bg-good/15 text-good-text" : "bg-warn/15 text-ink-2"
        }`}
      >
        {confirmed ? (
          <IconCheck size={11} />
        ) : (
          <IconAlert size={11} className="text-warn" />
        )}
        {confirmed ? t("guide.statusConfirmed") : t("guide.statusUnverified")}
      </div>
      <p className="text-xs leading-relaxed text-ink-3">{note}</p>
    </div>
  );
}

export default function GuidePage() {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm leading-relaxed text-ink-2">{t("guide.intro")}</p>

      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <IconValve size={16} className="text-brand" />
          <h2 className="text-sm font-semibold text-ink">{t("guide.overviewTitle")}</h2>
        </div>
        <p className="text-sm leading-relaxed text-ink-2">{t("guide.overviewBody")}</p>
      </Card>

      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <IconValve size={16} className="text-brand" />
          <h2 className="text-sm font-semibold text-ink">{t("guide.relayMapTitle")}</h2>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-ink-2">{t("guide.relayMapBody")}</p>

        {/*
          One output, and it is the LATCHING relay.

          The TRB141 has two: Relay (3,4,5) and Latching Relay (11,12,13).
          The plain relay needs coil power to stay switched, and the TRB is
          powered from the building whose supply is being cut — so a power
          blip releases it and an apartment that was cut off silently gets
          water back, while the dashboard still shows it as cut. The latching
          relay holds mechanically with no power, which is what a
          set-and-leave supply cutoff actually requires.
        */}
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <OutputFlow
            label="V1"
            target={t("guide.relayOutput1Target")}
            keywords="valveon / valveoff"
            status="confirmed"
            note={t("guide.relayOutput1Note")}
          />
          <OutputFlow
            label={t("guide.relayUnusedLabel")}
            target={t("guide.relayOutput2Target")}
            keywords="—"
            status="unverified"
            note={t("guide.relayOutput2Note")}
          />
        </div>

        <Callout tone="warn">{t("guide.relayMapWarn")}</Callout>
      </Card>

      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <IconAlert size={16} className="text-warn" />
          <h2 className="text-sm font-semibold text-ink">{t("guide.relayTrapTitle")}</h2>
        </div>
        <p className="text-sm leading-relaxed text-ink-2">{t("guide.relayTrapBody")}</p>
      </Card>

      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <IconRadio size={16} className="text-brand" />
          <h2 className="text-sm font-semibold text-ink">{t("guide.step1Title")}</h2>
        </div>
        <p className="mb-3 text-xs text-ink-3">{t("guide.step1Intro")}</p>
        <ol className="mb-3 list-decimal space-y-2 ps-5 text-sm leading-relaxed text-ink-2">
          <li>{t("guide.step1a")}</li>
          <li>{t("guide.step1b")}</li>
          <li>{t("guide.step1c")}</li>
          <li>{t("guide.step1d")}</li>
          <li>{t("guide.step1e")}</li>
        </ol>
        <Callout tone="warn">{t("guide.step1warn")}</Callout>
      </Card>

      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <IconRadio size={16} className="text-brand" />
          <h2 className="text-sm font-semibold text-ink">{t("guide.step2Title")}</h2>
        </div>
        <ol className="mb-3 list-decimal space-y-2 ps-5 text-sm leading-relaxed text-ink-2">
          <li>{t("guide.step2a")}</li>
          <li>{t("guide.step2b")}</li>
          <li>{t("guide.step2c")}</li>
        </ol>
        <Callout tone="good">{t("guide.step2body")}</Callout>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-sm font-semibold text-ink">{t("guide.matchTitle")}</h2>
        <p className="text-sm leading-relaxed text-ink-2">{t("guide.matchBody")}</p>
      </Card>

      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <IconLock size={16} className="text-ink-3" />
          <h2 className="text-sm font-semibold text-ink">{t("guide.authTitle")}</h2>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-ink-2">{t("guide.authBody")}</p>
        <Callout tone="warn">{t("guide.authWarn")}</Callout>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-sm font-semibold text-ink">{t("guide.juggleTitle")}</h2>
        <p className="text-sm leading-relaxed text-ink-2">{t("guide.juggleBody")}</p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t("guide.checklistTitle")}</h2>
        <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed text-ink-2">
          <li>{t("guide.check1")}</li>
          <li>{t("guide.check2")}</li>
          <li>{t("guide.check3")}</li>
          <li>{t("guide.check4")}</li>
          <li>{t("guide.check5")}</li>
        </ol>
      </Card>
    </div>
  );
}
