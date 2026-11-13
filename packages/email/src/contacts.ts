/**
 * News subscribers in Resend (owner 2026-11-12). SERVER-ONLY: the key can read and change the whole contact list.
 *
 * Resend keeps the list ("contacts") and the group we send news broadcasts to (a "segment", RESEND_SEGMENT_ID).
 * The Resend dashboard sends the broadcasts and handles their unsubscribe link itself. This module only:
 *   subscribeContact(email, locale)  → contact exists, is subscribed, and is in our segment
 *   unsubscribeContact(email)         → contact stays but gets no broadcasts (unsubscribed = global in Resend)
 *   removeContact(email)              → contact deleted (account deletion: nothing kept)
 * Callers decide WHO may be subscribed (proven, opted-in adults only): @repo/auth/news.
 *
 * Key: contacts need a FULL-ACCESS Resend key (a "sending access" key is refused). RESEND_CONTACTS_API_KEY is
 * used when set, so the sending key elsewhere can stay "sending only"; otherwise RESEND_API_KEY (the owner's
 * family key is full access, checked 2026-11-12).
 * Development never calls Resend unless EMAIL_DEV_SEND=true (same rule as emails): it prints instead.
 * Errors throw with Resend's error name/message only, never the address (privacy).
 * Notes: docs/vendor/resend.md "Contacts + segments".
 */
import "server-only";
import { Resend } from "resend";

let client: Resend | null = null;

function api(): Resend {
  const key = process.env.RESEND_CONTACTS_API_KEY || process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  client ??= new Resend(key);
  return client;
}

function segmentId(): string {
  const id = process.env.RESEND_SEGMENT_ID;
  if (!id) throw new Error("RESEND_SEGMENT_ID is not set");
  return id;
}

/** Outside production, print instead of calling Resend unless EMAIL_DEV_SEND=true (see sendEmail). */
function devPrint(action: string, email: string): boolean {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  if (process.env.NODE_ENV === "production" || process.env.EMAIL_DEV_SEND === "true") return false;
  console.info(`[contacts:dev] ${action} ${email}`);
  return true;
}

type ResendError = { name: string; message: string } | null;
const fail = (what: string, e: NonNullable<ResendError>) => new Error(`Resend ${what} failed: ${e.name}: ${e.message}`);

/**
 * Make sure the email is a SUBSCRIBED contact in our news segment. Safe to call again (idempotent): an existing
 * contact is switched back to subscribed (the person just gave fresh consent) and (re)added to the segment.
 */
export async function subscribeContact(email: string): Promise<void> {
  if (devPrint("subscribe", email)) return;
  const resend = api();
  const seg = segmentId();
  // Existing contact? Update first: Resend's create fails for an address it already has.
  const updated = await resend.contacts.update({ email, unsubscribed: false });
  if (updated.error) {
    if (updated.error.name !== "not_found") throw fail("contact update", updated.error);
    const created = await resend.contacts.create({ email, unsubscribed: false, segments: [{ id: seg }] });
    if (created.error) throw fail("contact create", created.error);
    return;
  }
  const added = await resend.contacts.segments.add({ email, segmentId: seg });
  if (added.error) throw fail("segment add", added.error);
}

/** Stop broadcasts to this email (kept as an unsubscribed contact, like Resend's own unsubscribe link). */
export async function unsubscribeContact(email: string): Promise<void> {
  if (devPrint("unsubscribe", email)) return;
  const res = await api().contacts.update({ email, unsubscribed: true });
  if (res.error && res.error.name !== "not_found") throw fail("contact unsubscribe", res.error);
}

/** Delete the contact entirely (account deletion). A contact that doesn't exist is already gone: fine. */
export async function removeContact(email: string): Promise<void> {
  if (devPrint("remove", email)) return;
  const res = await api().contacts.remove({ email });
  if (res.error && res.error.name !== "not_found") throw fail("contact remove", res.error);
}
