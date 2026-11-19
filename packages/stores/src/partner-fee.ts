/**
 * FOUNDING PARTNER FEE (owner 2026-11-18, docs/plans/founding-partners.md slice 2). SERVER-ONLY. ADMIN ONLY.
 *
 * A one-time BUSINESS payment a company makes to become a founding partner. It is NEVER a donation: no donation
 * receipt, no pool, never Christmas Magic, never refunded (owner). Paid offline (check / ACH / wire) and recorded
 * here by an admin; card is only a label for the rare case the owner arranges one by hand.
 *
 * States: not_required (default) → due → paid | waived;   due → not_required (admin cleared it).
 * Visibility: while "due" the store can't be approved (approveStore / acceptStoreInvite), and families only ever
 * see approved stores, so nothing else in the app needs to know about the fee.
 *
 * Every change: ONE transaction with a compare-and-set on the fee status (two admins can't both mark it paid),
 * an AuditLog row, then the email (best-effort, AFTER the change: a mail problem never undoes a recorded payment).
 */
import "server-only";
import { createHash } from "node:crypto";
import { AuditLog, connectDb, PlatformSettings, Store, trusted, User, withTransaction, type AuditAction, type DbSession } from "@repo/db";
import { sendEmail } from "@repo/email";
import { localizePath } from "@repo/i18n/paths";
import { formatCents, formatLongDate } from "@repo/lib/format";
import { MAX_PARTNER_FEE_CENTS, PARTNER_FEE_METHODS, type PartnerFeeMethod } from "@repo/lib/limits";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@repo/lib/locales";
import { calendarDateIn, getSeasonYear, isoDay, parseIsoDay, startOfDayInZone } from "@repo/lib/season";
import { storeAppOrigin } from "./urls.ts";

export type FeeActor = { id: string; role: string };
export type FeeResult = { ok: true; emailFailed?: boolean } | { ok: false; error: "notFound" | "feeState" | "badStatus" | "invalid" };

/** A fee can be SET only before the store is live: never hide a store families already use. */
const FEE_SETTABLE_STATUSES = ["invited", "pending"] as const;

function assertAdmin(actor: FeeActor) {
  // Defence in depth: the Server Action already called requireRole(..., "admin").
  if (actor.role !== "admin") throw new Error("admin role required");
}

/** One per store, forever (the fee is one-time): a hash of the store id, so it never collides or changes. */
export function partnerFeeInvoiceNo(storeId: string): string {
  return `FP-${createHash("sha256").update(`partner-fee/${storeId}`).digest("hex").slice(0, 12).toUpperCase()}`;
}

async function audit(session: DbSession, actor: FeeActor, action: AuditAction, storeId: string, details: Record<string, unknown>) {
  await AuditLog.create([{ actorUserId: actor.id, action, targetType: "store", targetId: storeId, details }], { session });
}

/** Why a change didn't apply: the store is gone, it's in a status that can't take it, or the fee moved on. */
async function explain(storeId: string): Promise<FeeResult> {
  const s = await Store.findById(storeId).select("status").lean();
  if (!s) return { ok: false, error: "notFound" };
  return { ok: false, error: (FEE_SETTABLE_STATUSES as readonly string[]).includes(s.status) ? "feeState" : "badStatus" };
}

/**
 * Who gets fee emails: the store's CONFIRMED owner, or (invited store, no owner yet) the address the ADMIN typed
 * on the invitation. Never an unconfirmed self-sign-up address (it may belong to someone else).
 */
async function recipient(storeId: string, fallbackLocale: Locale): Promise<{ to: string; locale: Locale } | null> {
  const s = await Store.findById(storeId).select("status ownerUserId contact.email").lean();
  if (!s) return null;
  if (s.ownerUserId) {
    const owner = await User.findById(s.ownerUserId).select("email locale status").lean();
    return owner?.status === "active" ? { to: owner.email, locale: isLocale(owner.locale) ? owner.locale : fallbackLocale } : null;
  }
  return s.status === "invited" && s.contact?.email ? { to: s.contact.email, locale: fallbackLocale } : null;
}

async function mail(storeId: string, locale: Locale, build: (link: string, locale: Locale) => Omit<Parameters<typeof sendEmail>[0], "to" | "locale">): Promise<boolean> {
  try {
    const r = await recipient(storeId, locale);
    if (!r) return true; // nobody we may write to yet: not a failure
    const link = new URL(localizePath("/dashboard", r.locale), storeAppOrigin()).toString();
    await sendEmail({ ...build(link, r.locale), to: r.to, locale: r.locale } as Parameters<typeof sendEmail>[0]);
    return true;
  } catch (err) {
    console.error("[partner-fee] email failed:", err instanceof Error ? err.name : "unknown"); // no address in logs
    return false;
  }
}

/** Set the fee (store becomes "fee due"), or change the amount while it is still due. Emails the invoice. */
export async function setPartnerFee(actor: FeeActor, storeId: string, amountCents: number, locale: string): Promise<FeeResult> {
  assertAdmin(actor);
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > MAX_PARTNER_FEE_CENTS) return { ok: false, error: "invalid" };
  await connectDb();
  const now = new Date();
  const done = await withTransaction(async (session) => {
    const before = await Store.findOneAndUpdate(
      {
        _id: storeId,
        status: trusted({ $in: [...FEE_SETTABLE_STATUSES] }),
        // Missing partnerFee (stores made before this feature) counts as not_required ($in null matches missing).
        "partnerFee.status": trusted({ $in: ["not_required", "due", null] }),
      },
      {
        $set: {
          "partnerFee.status": "due",
          "partnerFee.amountCents": amountCents,
          "partnerFee.invoiceNo": partnerFeeInvoiceNo(storeId),
          "partnerFee.dueSetAt": now,
          "partnerFee.recordedByUserId": actor.id,
        },
      },
      { session, runValidators: true },
    )
      .select("partnerFee.status partnerFee.amountCents")
      .lean();
    if (!before) return false;
    await audit(session, actor, "store.fee_set", storeId, { amountCents, from: before.partnerFee?.status ?? "not_required", previousAmountCents: before.partnerFee?.amountCents ?? null });
    return true;
  });
  if (!done) return explain(storeId);
  return { ok: true, emailFailed: !(await sendInvoice(storeId, isLocale(locale) ? locale : DEFAULT_LOCALE)) };
}

/** (Re)send the invoice email for a store whose fee is due. */
export async function sendInvoice(storeId: string, locale: Locale): Promise<boolean> {
  const [s, settings] = await Promise.all([
    Store.findById(storeId).select("name partnerFee").lean(),
    PlatformSettings.findOne({ key: "platform" }).select("charity").lean(),
  ]);
  if (!s || s.partnerFee?.status !== "due" || !s.partnerFee.amountCents || !s.partnerFee.invoiceNo) return false;
  const fee = s.partnerFee;
  return mail(storeId, locale, (link, lang) => ({
    template: "partnerFeeInvoice",
    values: {
      link,
      storeName: s.name,
      invoiceNo: fee.invoiceNo!,
      amount: formatCents(fee.amountCents!),
      date: formatLongDate(fee.dueSetAt ?? new Date(), lang, "long"),
      orgName: settings?.charity?.legalName || "Spirit of Santa",
      orgAddress: settings?.charity?.address || "",
    },
    // Amount in the key: a changed amount is a new invoice email; a double click is not.
    idempotencyKey: `partner-fee-invoice/${storeId}/${fee.amountCents}/${fee.dueSetAt?.getTime() ?? 0}`,
  }));
}

/** Admin changed their mind before payment: due → not required (e.g. a local store after all). */
export async function clearPartnerFee(actor: FeeActor, storeId: string): Promise<FeeResult> {
  assertAdmin(actor);
  await connectDb();
  const done = await withTransaction(async (session) => {
    const before = await Store.findOneAndUpdate(
      { _id: storeId, "partnerFee.status": "due" },
      { $set: { "partnerFee.status": "not_required", "partnerFee.recordedByUserId": actor.id }, $unset: { "partnerFee.amountCents": 1, "partnerFee.dueSetAt": 1 } },
      { session },
    )
      .select("partnerFee.amountCents")
      .lean();
    if (!before) return false;
    await audit(session, actor, "store.fee_cleared", storeId, { amountCents: before.partnerFee?.amountCents ?? null });
    return true;
  });
  return done ? { ok: true } : explain(storeId);
}

export type FeePaymentInput = { paidOn: string; via: PartnerFeeMethod; reference: string };

/**
 * Record the payment (money already in the bank). paidOn = the day it arrived (YYYY-MM-DD, Central Time), never in
 * the future. Emails the store a receipt of payment (a BUSINESS receipt: not the donation receipt).
 */
export async function markPartnerFeePaid(actor: FeeActor, storeId: string, input: FeePaymentInput, locale: string): Promise<FeeResult> {
  assertAdmin(actor);
  if (!parseIsoDay(input.paidOn) || input.paidOn > isoDay(calendarDateIn(new Date()))) return { ok: false, error: "invalid" };
  if (!(PARTNER_FEE_METHODS as readonly string[]).includes(input.via) || input.reference.length > 120) return { ok: false, error: "invalid" };
  await connectDb();
  const paidAt = startOfDayInZone(input.paidOn);
  const done = await withTransaction(async (session) => {
    const before = await Store.findOneAndUpdate(
      { _id: storeId, "partnerFee.status": "due" },
      {
        $set: {
          "partnerFee.status": "paid",
          "partnerFee.paidAt": paidAt,
          "partnerFee.paidSeasonYear": getSeasonYear(paidAt),
          "partnerFee.paidVia": input.via,
          "partnerFee.reference": input.reference,
          "partnerFee.recordedByUserId": actor.id,
        },
      },
      { session, runValidators: true },
    )
      .select("partnerFee.amountCents")
      .lean();
    if (!before) return false;
    await audit(session, actor, "store.fee_paid", storeId, { amountCents: before.partnerFee?.amountCents ?? null, via: input.via, paidOn: input.paidOn });
    return true;
  });
  if (!done) return explain(storeId);
  return { ok: true, emailFailed: !(await sendPaidReceipt(storeId, isLocale(locale) ? locale : DEFAULT_LOCALE)) };
}

const METHOD_LABEL: Record<Locale, Record<PartnerFeeMethod, string>> = {
  en: { check: "check", ach: "ACH bank transfer", wire: "wire transfer", card: "card" },
  es: { check: "cheque", ach: "transferencia ACH", wire: "transferencia bancaria", card: "tarjeta" },
};

async function sendPaidReceipt(storeId: string, locale: Locale): Promise<boolean> {
  const s = await Store.findById(storeId).select("name partnerFee").lean();
  const fee = s?.partnerFee;
  if (!s || fee?.status !== "paid" || !fee.amountCents || !fee.paidAt || !fee.invoiceNo) return false;
  return mail(storeId, locale, (link, lang) => ({
    template: "partnerFeePaid",
    values: {
      link,
      storeName: s.name,
      invoiceNo: fee.invoiceNo!,
      amount: formatCents(fee.amountCents!),
      paidDate: formatLongDate(fee.paidAt!, lang, "long"),
      method: METHOD_LABEL[lang][fee.paidVia as PartnerFeeMethod] ?? "",
      reference: fee.reference ? ` (ref ${fee.reference})` : "",
    },
    idempotencyKey: `partner-fee-paid/${storeId}`,
  }));
}

/** Waive the fee (e.g. a small local store). A reason is required: it is part of the record. */
export async function waivePartnerFee(actor: FeeActor, storeId: string, reason: string): Promise<FeeResult> {
  assertAdmin(actor);
  const why = reason.trim();
  if (why.length < 3 || why.length > 500) return { ok: false, error: "invalid" };
  await connectDb();
  const done = await withTransaction(async (session) => {
    const before = await Store.findOneAndUpdate(
      { _id: storeId, "partnerFee.status": "due" },
      { $set: { "partnerFee.status": "waived", "partnerFee.waivedReason": why, "partnerFee.recordedByUserId": actor.id } },
      { session, runValidators: true },
    )
      .select("partnerFee.amountCents")
      .lean();
    if (!before) return false;
    await audit(session, actor, "store.fee_waived", storeId, { amountCents: before.partnerFee?.amountCents ?? null });
    return true;
  });
  return done ? { ok: true } : explain(storeId);
}

/** Partner-fee money that ARRIVED in a season (admin money summary). Business income, never a donation. */
export async function partnerFeesReceived(seasonYear: number): Promise<{ cents: number; count: number }> {
  await connectDb();
  const [row] = await Store.aggregate<{ cents: number; count: number }>([
    { $match: { "partnerFee.status": "paid", "partnerFee.paidSeasonYear": seasonYear } },
    { $group: { _id: null, cents: { $sum: "$partnerFee.amountCents" }, count: { $sum: 1 } } },
  ]);
  return { cents: row?.cents ?? 0, count: row?.count ?? 0 };
}

export type PartnerFeeStatus = "not_required" | "due" | "paid" | "waived";
/** Everything the fee card and the invoice need (serializable: ISO dates). ONE reader for admin + store app. */
export type PartnerFeeView = {
  storeId: string;
  storeName: string;
  storeStatus: string;
  status: PartnerFeeStatus;
  amountCents?: number;
  invoiceNo?: string;
  dueSetAt?: string;
  paidAt?: string;
  paidVia?: PartnerFeeMethod;
  reference?: string;
  waivedReason?: string;
  /** Who the fee is payable to: the charity details an admin set (Settings). */
  orgName: string;
  orgAddress: string;
};

export async function getPartnerFee(storeId: string): Promise<PartnerFeeView | null> {
  await connectDb();
  const [s, settings] = await Promise.all([
    Store.findById(storeId).select("name status partnerFee").lean(),
    PlatformSettings.findOne({ key: "platform" }).select("charity").lean(),
  ]);
  if (!s) return null;
  const f = s.partnerFee;
  return {
    storeId: String(s._id),
    storeName: s.name,
    storeStatus: s.status,
    status: (f?.status as PartnerFeeStatus | undefined) ?? "not_required",
    ...(f?.amountCents ? { amountCents: f.amountCents } : {}),
    ...(f?.invoiceNo ? { invoiceNo: f.invoiceNo } : {}),
    ...(f?.dueSetAt ? { dueSetAt: f.dueSetAt.toISOString() } : {}),
    ...(f?.paidAt ? { paidAt: f.paidAt.toISOString() } : {}),
    ...(f?.paidVia ? { paidVia: f.paidVia as PartnerFeeMethod } : {}),
    ...(f?.reference ? { reference: f.reference } : {}),
    ...(f?.waivedReason ? { waivedReason: f.waivedReason } : {}),
    orgName: settings?.charity?.legalName || "Spirit of Santa",
    orgAddress: settings?.charity?.address || "",
  };
}

/** A fee can be set on this store now (invited/pending, and not already paid or waived). */
export function feeSettable(v: Pick<PartnerFeeView, "storeStatus" | "status">): boolean {
  return (FEE_SETTABLE_STATUSES as readonly string[]).includes(v.storeStatus) && (v.status === "not_required" || v.status === "due");
}

/**
 * The invoice's content, ONE builder for the admin copy and the store's copy (labels from Common.feeInvoice).
 * `t` = a translator for that namespace. Dates in the season time zone.
 */
export function buildFeeInvoice(v: PartnerFeeView, t: (key: string, values?: Record<string, string>) => string, locale: Locale) {
  const day = (iso?: string) => (iso ? formatLongDate(new Date(iso), locale, "long") : "—");
  const status =
    v.status === "paid" ? t("statusPaid", { date: day(v.paidAt) }) : v.status === "waived" ? t("statusWaived") : v.status === "due" ? t("statusDue") : t("statusNone");
  return {
    title: t("title"),
    rows: [
      { label: t("invoiceNo"), value: v.invoiceNo ?? "—" },
      { label: t("date"), value: day(v.dueSetAt) },
      { label: t("billedTo"), value: v.storeName },
      { label: t("payableTo"), value: [v.orgName, v.orgAddress].filter(Boolean).join("\n") },
      { label: t("description"), value: t("item") },
      { label: t("amount"), value: v.amountCents ? formatCents(v.amountCents) : "—" },
      { label: t("status"), value: status },
    ],
    notes: [t("notDonation"), t("howToPay")],
  };
}
