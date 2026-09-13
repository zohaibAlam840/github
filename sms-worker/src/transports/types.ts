/**
 * One shared interface for "send an SMS, get told about replies" —
 * the SIM7600G-H on its COM port implements this, and so does the supervisor
 * that owns it, so nothing downstream has to know which modem instance is
 * live at any moment.
 */

export interface SendResult {
  ok: boolean;
  /** Transport-specific id for polling delivery status later, if supported. */
  providerId?: string;
  error?: string;
}

export interface IncomingSms {
  fromNumber: string;
  text: string;
  receivedAt: Date;
}

export type IncomingSmsHandler = (msg: IncomingSms) => void;
export type Unsubscribe = () => void;

export interface SmsTransport {
  readonly name: string;

  /** Send one SMS. Resolves once the transport ACCEPTED the send — not the same as delivered. */
  send(toNumber: string, text: string): Promise<SendResult>;

  /** Optional: poll delivery status for a message returned by send(). */
  checkStatus?(providerId: string): Promise<{ state: string } | null>;

  /**
   * Register a callback fired whenever an inbound SMS arrives (webhook or
   * serial RX). Returns an unsubscribe function — callers waiting on ONE
   * specific reply (see confirmationTracker.ts) must unsubscribe once
   * resolved, or handlers accumulate for the life of the process.
   */
  onReceive(handler: IncomingSmsHandler): Unsubscribe;
}
