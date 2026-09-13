/**
 * Worker configuration, from environment variables / .env.
 *
 * This worker drives ONE thing: a cellular modem on a serial port
 * (SIM7600G-H, or any Hayes-compatible module). The phone-gateway path was
 * removed — there is no fallback transport by design.
 *
 * Anything here that could differ between deployments is a setting rather
 * than a constant, deliberately. Every one of these was, at some point, a
 * value we would otherwise have had to change in code while sitting on a
 * remote session at the client's office.
 */

export interface WorkerConfig {
  /** Leave null to auto-detect: every serial port is probed and qualified. */
  comPort: string | null;
  baudRate: number;
  /** Port the local HTTP control server listens on (the dashboard calls it). */
  controlPort: number;

  /** Must match the SMS Utilities rules configured on the TRB141 devices. */
  keywordOpen: string;
  keywordClose: string;
  keywordStatus: string;

  /**
   * How a TRB reply is turned into a relay state. Bench replies look like
   * "Relay - Open" / "Relay - Closed", but the template is editable on the
   * device, so these are patterns rather than hard-coded words. If a client's
   * units answer differently, this is a settings change, not a code change.
   */
  replyOnPattern: string;
  replyOffPattern: string;

  /**
   * Numbers are typed into the dashboard in whatever format suits the
   * operator ("03401588816"), but AT+CMGS wants international format. A
   * local number is rewritten as <countryCode> + number-without-leading-zero.
   * Set to "" to disable rewriting and send exactly what was stored.
   */
  defaultCountryCode: string;

  /**
   * SMS service centre. Normally provisioned by the SIM and left blank here;
   * set it only if AT+CSCA? comes back empty, which makes every send fail
   * silently.
   */
  smscOverride: string | null;

  /** Gateway used for the first-connect verification round trip. */
  testGatewaySim: string | null;
  testGatewayPassword: string | null;

  /** How often the supervisor checks the modem is still present and healthy. */
  healthTickMs: number;
  /** Safety-net sweep for inbound messages the +CMTI push missed. */
  sweepIntervalMs: number;
  /** Write every AT line in and out to data/at-log.txt. */
  rawLog: boolean;
  /**
   * Clear modem/SIM message storage at startup. Off by default — it deletes
   * messages this worker never received (operator notifications, anything a
   * previous session left). A SIM holds only ~20, so a machine whose storage
   * has silted up needs this once.
   */
  purgeStorageOnStart: boolean;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): WorkerConfig {
  return {
    comPort: process.env.COM_PORT ?? null,
    baudRate: num("BAUD_RATE", 115_200),
    controlPort: num("CONTROL_PORT", 3900),

    keywordOpen: process.env.KEYWORD_OPEN ?? "valveon",
    keywordClose: process.env.KEYWORD_CLOSE ?? "valveoff",
    keywordStatus: process.env.KEYWORD_STATUS ?? "iostatus",

    replyOnPattern: process.env.REPLY_ON_PATTERN ?? "clos",
    replyOffPattern: process.env.REPLY_OFF_PATTERN ?? "open",

    defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE ?? "+974",
    smscOverride: process.env.SMSC ?? null,

    testGatewaySim: process.env.TEST_GATEWAY_SIM ?? null,
    testGatewayPassword: process.env.TEST_GATEWAY_PASSWORD ?? null,

    healthTickMs: num("HEALTH_TICK_MS", 15_000),
    sweepIntervalMs: num("SWEEP_INTERVAL_MS", 120_000),
    rawLog: process.env.RAW_LOG !== "false",
    purgeStorageOnStart: process.env.PURGE_STORAGE_ON_START === "true",
  };
}
