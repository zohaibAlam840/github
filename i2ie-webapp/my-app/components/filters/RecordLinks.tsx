"use client";

/*
 * Links from a history row back to the thing it is about.
 *
 * A log or queue row names a valve, a building and a TRB, but naming them
 * is a dead end — the operator reading "TEST2 failed" then has to go and
 * find TEST2 by hand. These put the row in its place: the valve under its
 * apartment, the apartment under its building, the TRB on its own page.
 *
 * Both degrade to plain text rather than a dead link when the id is null.
 * Command history outlives the valve it describes — that is the point of an
 * audit log — so a row about a deleted valve is normal, not an error.
 */

import Link from "next/link";

const LINK =
  "font-medium text-ink hover:text-brand hover:underline";

export function ValveLink({
  valveId,
  unitId,
  buildingId,
  valveCode,
  className = LINK,
}: {
  valveId: number;
  unitId: number | null;
  buildingId: number | null;
  valveCode: string;
  className?: string;
}) {
  if (unitId === null || buildingId === null) {
    return <span className="font-medium text-ink">{valveCode}</span>;
  }
  return (
    <Link
      href={`/buildings/valve?building=${buildingId}&unit=${unitId}&valve=${valveId}`}
      className={className}
    >
      {valveCode}
    </Link>
  );
}

export function BuildingLink({
  buildingId,
  buildingName,
  className = "text-ink-2 hover:text-brand hover:underline",
}: {
  buildingId: number | null;
  buildingName: string;
  className?: string;
}) {
  if (buildingId === null) return <span className="text-ink-2">{buildingName}</span>;
  return (
    <Link href={`/buildings/detail?id=${buildingId}`} className={className}>
      {buildingName}
    </Link>
  );
}

export function GatewayLink({
  gatewayId,
  gatewayLabel,
  className = "text-ink-2 hover:text-brand hover:underline",
}: {
  gatewayId: number | null;
  gatewayLabel: string;
  className?: string;
}) {
  if (gatewayId === null) return <span className="text-ink-2">{gatewayLabel}</span>;
  return (
    <Link href={`/gateways/detail?id=${gatewayId}`} className={className}>
      {gatewayLabel}
    </Link>
  );
}
