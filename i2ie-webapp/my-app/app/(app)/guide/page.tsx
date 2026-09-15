"use client";

/*
 * TRB141 Guide — a static reference page, not a data screen. Written from
 * what's actually been bench-confirmed on real hardware (see memory /
 * i2i-CMS-BUILD-BRIEF.md), not just the Teltonika docs — anything not yet
 * verified against real hardware is flagged as such, same honesty rule the
 * rest of this project follows.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui";
import { api } from "@/lib/api";
import { VideoManual } from "@/components/guide/VideoManual";
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

/**
 * The three SMS Utilities rules, laid out the way the TRB141's own form asks
 * for them, so a technician can copy this screen field by field instead of
 * translating prose into a web UI.
 *
 * The keywords are read LIVE from Settings rather than hard-coded. Keyword
 * drift between this dashboard and the device is the single most common way
 * a gateway ends up silently ignoring every command, and a printed sheet
 * showing "valveon" while Settings says something else would cause exactly
 * the bug the sheet exists to prevent. If the fetch fails we show the
 * defaults and say so, rather than showing them as if they were confirmed.
 */
function RuleSheet() {
  const { t } = useTranslation();
  const [keywords, setKeywords] = useState<{
    open: string;
    close: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    api.settings
      .get()
      .then((s) => {
        if (!alive) return;
        setKeywords({
          open: s.keywordOpen,
          close: s.keywordClose,
          status: s.keywordStatus,
        });
      })
      .catch(() => {
        /* Falls through to the defaults + a warning. */
      });
    return () => {
      alive = false;
    };
  }, []);

  const live = keywords !== null;
  const kw = keywords ?? { open: "valveon", close: "valveoff", status: "iostatus" };

  const columns = [
    {
      head: t("guide.ruleRule1"),
      keyword: kw.open,
      action: t("guide.ruleActionIo"),
      target: t("guide.ruleTargetLatching"),
      state: t("guide.ruleStateClosed"),
      message: "—",
    },
    {
      head: t("guide.ruleRule2"),
      keyword: kw.close,
      action: t("guide.ruleActionIo"),
      target: t("guide.ruleTargetLatching"),
      state: t("guide.ruleStateOpen"),
      message: "—",
    },
    {
      head: t("guide.ruleRule3"),
      keyword: kw.status,
      action: t("guide.ruleActionStatus"),
      target: "—",
      state: "—",
      message: "Relay - %rl",
    },
  ];

  const rows: { label: string; pick: (c: (typeof columns)[number]) => string; mono?: boolean }[] = [
    { label: t("guide.ruleRowKeyword"), pick: (c) => c.keyword, mono: true },
    { label: t("guide.ruleRowAction"), pick: (c) => c.action },
    { label: t("guide.ruleRowTarget"), pick: (c) => c.target },
    { label: t("guide.ruleRowState"), pick: (c) => c.state },
    { label: t("guide.ruleRowMessage"), pick: (c) => c.message, mono: true },
    { label: t("guide.ruleRowAuth"), pick: () => t("guide.ruleAuthNone") },
  ];

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <IconRadio size={16} className="text-brand" />
        <h2 className="text-sm font-semibold text-ink">{t("guide.ruleSheetTitle")}</h2>
      </div>
      <p className="mb-3 text-sm leading-relaxed text-ink-2">{t("guide.ruleSheetBody")}</p>

      {/* Wide content on a narrow screen scrolls itself, never the page. */}
      <div className="-mx-1 mb-3 overflow-x-auto px-1">
        <table className="w-full min-w-[34rem] border-collapse text-xs" dir="ltr">
          <thead>
            <tr>
              <th className="border-b border-edge py-2 pe-3 text-start font-medium text-ink-3">
                {t("guide.ruleColField")}
              </th>
              {columns.map((c) => (
                <th
                  key={c.head}
                  className="border-b border-edge px-3 py-2 text-start font-semibold text-ink"
                >
                  {c.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="border-b border-hairline py-2 pe-3 align-top text-ink-3">
                  {row.label}
                </td>
                {columns.map((c) => (
                  <td
                    key={c.head}
                    className={`border-b border-hairline px-3 py-2 align-top text-ink-2 ${
                      row.mono ? "font-mono" : ""
                    }`}
                  >
                    {row.pick(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <Callout tone={live ? "good" : "warn"}>
          {live ? t("guide.ruleSheetLive") : t("guide.ruleSheetFallback")}
        </Callout>
        <Callout tone="warn">{t("guide.ruleSheetOneRelay")}</Callout>
        <p className="text-xs leading-relaxed text-ink-3">{t("guide.ruleSheetAuthNote")}</p>
      </div>
    </Card>
  );
}

export default function GuidePage() {
  const { t } = useTranslation();
  /*
   * Two halves, deliberately in this order.
   *
   * "How do I use the dashboard" is the question almost everyone arrives
   * with, so the video manual comes first. The TRB141 hardware reference
   * below it is for the one person commissioning a gateway — important, but
   * consulted far less often.
   */
  const [tab, setTab] = useState<"manual" | "hardware">("manual");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-hairline">
        {(["manual", "hardware"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
              tab === k
                ? "border-brand text-brand"
                : "border-transparent text-ink-3 hover:text-ink-2"
            }`}
          >
            {t(`guide.tab_${k}`)}
          </button>
        ))}
      </div>

      {tab === "manual" && <VideoManual />}

      {tab === "hardware" && (
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

      {/*
        The field sheet sits directly after the "which relay" cards and
        before the prose steps on purpose: by this point the reader knows
        WHICH relay and WHY, and what they want next is the literal set of
        values to type. The steps below explain the same three rules in
        sentences for whoever is reading rather than doing.
      */}
      <RuleSheet />

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
          {/*
            The acceptance test for the latching-relay decision. Everything
            above can pass while the rule is quietly pointed at the plain
            relay (3,4,5) — the two look identical until the power drops,
            which is the one moment this project cannot afford to get wrong.
          */}
          <li>{t("guide.check6")}</li>
        </ol>
      </Card>
    </div>
      )}
    </div>
  );
}
