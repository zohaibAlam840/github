"use client";

/*
 * The video manual — eleven chapters, played inside the dashboard.
 *
 * Deliberately local files, not a streaming service: this system is fully
 * offline by requirement, so the videos are served by the dashboard itself
 * from public/videos/. Nothing here reaches the internet.
 *
 * Every chapter carries WRITTEN STEPS as well as a video, and the steps are
 * not a transcript — they are the thing an operator actually uses. A video
 * cannot be searched, skimmed, or read over someone's shoulder while they
 * do the task, and it cannot be followed at all by someone on a call. The
 * video is for learning it once; the steps are for doing it.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui";
import { IconAlert, IconBook, IconPlay, IconSearch } from "@/components/icons";

/** Chapter ids match the recorder's filenames — tools/demo/chapters/index.ts. */
const CHAPTERS = [
  "01-signin",
  "02-roles",
  "03-buildings",
  "04-control",
  "05-assumed",
  "06-stop",
  "07-bulk",
  "08-queue",
  "09-modem",
  "10-settings",
  "11-arabic",
  "12-addtrb",
] as const;

type ChapterId = (typeof CHAPTERS)[number];

export function VideoManual() {
  const { t } = useTranslation();
  const [active, setActive] = useState<ChapterId>("01-signin");
  const [query, setQuery] = useState("");

  /*
   * Search covers titles, summaries AND step text, because the question an
   * operator actually has is "how do I stop a command", not "which chapter
   * is about stopping".
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CHAPTERS as readonly ChapterId[];
    return CHAPTERS.filter((id) => {
      const steps = t(`manual.${id}.steps`, { returnObjects: true });
      const notes = t(`manual.${id}.watch`, { returnObjects: true });
      const hay = [
        t(`manual.${id}.title`),
        t(`manual.${id}.summary`),
        t(`manual.${id}.why`),
        ...(Array.isArray(steps) ? (steps as string[]) : []),
        ...(Array.isArray(notes) ? (notes as string[]) : []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query, t]);

  const steps = t(`manual.${active}.steps`, { returnObjects: true });
  const stepList = Array.isArray(steps) ? (steps as string[]) : [];
  const watch = t(`manual.${active}.watch`, { returnObjects: true });
  const watchList = Array.isArray(watch) ? (watch as string[]) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
      {/* Chapter list */}
      <Card className="h-fit p-3">
        <label className="relative mb-2 block">
          <IconSearch
            size={14}
            className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("manual.search")}
            className="w-full rounded-lg border border-edge bg-surface py-1.5 pe-3 ps-8 text-xs text-ink outline-none focus:border-brand"
          />
        </label>

        {matches.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-ink-3">{t("manual.noMatch")}</p>
        ) : (
          <ol className="space-y-0.5">
            {matches.map((id, i) => (
              <li key={id}>
                <button
                  onClick={() => setActive(id)}
                  className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start text-xs transition-colors ${
                    active === id
                      ? "bg-brand/10 font-medium text-brand"
                      : "text-ink-2 hover:bg-hairline/40"
                  }`}
                >
                  <span className="mt-px shrink-0 tabular-nums text-ink-3">
                    {String(CHAPTERS.indexOf(id) + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">{t(`manual.${id}.title`)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* The chapter itself */}
      <div className="space-y-4">
        <Card className="overflow-hidden">
          {/*
            key={active} forces a fresh <video> on every chapter change.
            Without it the browser keeps the previous element and, having
            already loaded a source, ignores the new one — you press a
            chapter and the old video is still sitting there.
          */}
          <video
            key={active}
            controls
            preload="metadata"
            playsInline
            className="aspect-video w-full bg-black"
            poster={`/videos/${active}.jpg`}
          >
            <source src={`/videos/${active}.webm`} type="video/webm" />
            {/* Shown when the file is missing — far better than a dead black
                rectangle with no explanation. */}
            {t("manual.videoMissing")}
          </video>

          <div className="p-5">
            <h2 className="text-base font-semibold text-ink">
              {t(`manual.${active}.title`)}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-3">
              {t(`manual.${active}.summary`)}
            </p>
          </div>
        </Card>

        {/*
          The reasoning behind the feature, not just its mechanics.
          An operator who knows WHY a state is marked assumed will use the
          system correctly under pressure; one who only memorised the button
          order will not.
        */}
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <IconBook size={15} className="text-ink-3" />
            <h3 className="text-sm font-semibold text-ink">{t("manual.why")}</h3>
          </div>
          <p className="text-sm leading-relaxed text-ink-2">
            {t(`manual.${active}.why`)}
          </p>
        </Card>

        {stepList.length > 0 && (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <IconPlay size={15} className="text-brand" />
              <h3 className="text-sm font-semibold text-ink">{t("manual.steps")}</h3>
            </div>
            <ol className="space-y-2.5">
              {stepList.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand">
                    {i + 1}
                  </span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {/*
          The gotchas. Separated from the steps on purpose: steps are what to
          do, these are what will bite you — and mixing them makes both
          harder to scan when someone is in a hurry.
        */}
        {watchList.length > 0 && (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <IconAlert size={15} className="text-warn" />
              <h3 className="text-sm font-semibold text-ink">{t("manual.watch")}</h3>
            </div>
            <ul className="space-y-2.5">
              {watchList.map((note, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                  <span className="min-w-0">{note}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
