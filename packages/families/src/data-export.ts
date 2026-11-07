/**
 * "What we store about your family" (Phase 8 slice 2b, COPPA: a parent may REVIEW everything held about their
 * child, and take a copy). SERVER-ONLY. ONE function feeds both the page and the JSON download, so they can never
 * disagree.
 *
 * Teaching note — what is deliberately NOT included: password/PIN hashes, login counters, MFA secrets, link
 * tokens, encrypted blobs (the address is shown DECRYPTED instead), payment-processor ids, internal ids of other
 * people (stores' staff, admins), and visitors' payments (tips and donations belong to the donors; their AMOUNTS are
 * in the child's Christmas Magic history). Everything else this app stores about the family is here (review
 * 2026-11-07 found payments, notes and gift dates missing: keep this list complete when a model gains a field).
 */
import "server-only";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { unsealJson } from "@repo/auth/sealed";
import { Deed, DeedType, Family, Item, Kid, KidVote, Payment, Transaction, trusted, User, WishListItem } from "@repo/db";
import type { DeliveryAddress } from "@repo/lib/address";
import { NOTIFY_KINDS } from "@repo/lib/notify";
import { ADDRESS_KEY } from "@repo/wishlists/delivery";

export type KidExport = {
  firstName: string;
  displayName: string;
  birthYear: number;
  registered: boolean;
  registeredAt: Date | null;
  registrationMethod: string | null;
  giftLimit: number;
  archivedAt: Date | null;
  christmasMagic: { availableCentipoints: number; heldForGiftsCentipoints: number };
  wishList: {
    gift: string;
    status: string;
    costCentipoints: number;
    fundedCentipoints: number;
    addedAt: Date;
    fullyFundedAt: Date | null;
    securedAt: Date | null;
    shippedAt: Date | null;
    trackingNote: string | null;
    receivedAt: Date | null;
    deliveredAt: Date | null;
    substituteNote: string | null;
    droppedAt: Date | null;
    droppedCentipoints: number | null;
  }[];
  goodDeeds: { deed: string; ownWords: string | null; ownWordsReview: string | null; status: string; outcome: string | null; tipCents: number | null; recordedAt: Date; confirmedAt: Date | null; codeExpiresAt: Date | null }[];
  votes: { day: string; vote: string }[];
  magicHistory: { type: string; centipoints: number; at: Date; note: string | null }[];
};

export type FamilyExport = {
  exportedAt: Date;
  parent: { email: string; name: string | null; language: string; accountCreated: Date | null; lastSignIn: Date | null; status: string };
  /** What the PARENT paid (registration, bonus, pay-up). Never processor ids. */
  payments: { purpose: string; status: string; amountCents: number; currency: string; paidAt: Date | null; refundedCents: number; children: string[] }[];
  family: {
    familyName: string;
    publicAlias: string | null;
    aliasReview: string | null;
    showAliasPublicly: boolean;
    zip: string | null;
    emailSettings: Record<string, boolean>;
    deliveryAddress: DeliveryAddress | null;
    /** An address IS stored but can't be decrypted (never claim "none" then). */
    deliveryAddressUnreadable: boolean;
    deliveryAddressUpdatedAt: Date | null;
    consent: { version: string | null; acceptedAt: Date | null; emailVerifiedAt: Date | null };
    pinSet: boolean;
  };
  children: KidExport[];
};

type Localized = { en?: string; es?: string } | string | undefined;
const titleOf = (t: Localized, locale: string) => (typeof t === "string" ? t : (t?.[locale as "en" | "es"] ?? t?.en ?? ""));

export async function familyDataExport(parent: Parent, locale = "en"): Promise<FamilyExport | null> {
  const fid = await ownFamilyId(parent);
  if (!fid) return null;
  const [user, fam, kids] = await Promise.all([
    User.findById(parent.id).select("email name locale createdAt lastLoginAt status").lean<{ email: string; name?: string; locale?: string; createdAt?: Date; lastLoginAt?: Date; status: string }>(),
    Family.findById(fid)
      .select("familyName alias aliasReview showAliasPublicly zip notify consent deliveryAddressUpdatedAt +deliveryAddressEnc +parentPinHash")
      .lean<{ familyName: string; alias?: string; aliasReview?: string; showAliasPublicly?: boolean; zip?: string; notify?: Record<string, unknown>; consent?: { version?: string; acceptedAt?: Date; emailVerifiedAt?: Date }; deliveryAddressUpdatedAt?: Date; deliveryAddressEnc?: string; parentPinHash?: string }>(),
    Kid.find({ familyId: fid }).sort({ createdAt: 1 }).lean(),
  ]);
  if (!user || !fam) return null;
  const kidIds = kids.map((k) => k._id);
  const [gifts, deeds, votes, ledger, payments] = await Promise.all([
    WishListItem.find({ kidId: trusted({ $in: kidIds }) })
      .select("kidId itemId status costCentipoints fundedCentipoints createdAt fullyFundedAt lockedAt shippedAt trackingNote receivedAt deliveredAt substituteNote forfeitedAt forfeitedCentipoints")
      .sort({ createdAt: 1 })
      .lean(),
    Deed.find({ kidId: trusted({ $in: kidIds }) }).select("kidId deedTypeId customDescription customReview status outcome tipCents createdAt confirmedAt expiresAt").sort({ createdAt: 1 }).lean(),
    KidVote.find({ kidId: trusted({ $in: kidIds }) }).select("kidId day vote").sort({ day: 1 }).lean(),
    Transaction.find({ kidId: trusted({ $in: kidIds }) }).select("kidId type amountCentipoints createdAt note").sort({ createdAt: 1 }).lean(),
    // The PARENT's own payments only (visitors' tips/donations are the donors' data).
    Payment.find({ familyId: fid, purpose: trusted({ $in: ["registration", "bonus", "payup"] }) })
      .select("purpose status amountCents currency succeededAt refundedCents kidId kidIds createdAt")
      .sort({ createdAt: 1 })
      .lean(),
  ]);
  const [items, deedTypes] = await Promise.all([
    Item.find({ _id: trusted({ $in: [...new Set(gifts.map((g) => String(g.itemId)))] }) }).select("name").lean(),
    DeedType.find({ _id: trusted({ $in: [...new Set(deeds.filter((d) => d.deedTypeId).map((d) => String(d.deedTypeId)))] }) }).select("title").lean(),
  ]);
  const itemName = new Map(items.map((i) => [String(i._id), i.name as string]));
  const deedTitle = new Map(deedTypes.map((d) => [String(d._id), titleOf(d.title as Localized, locale)]));
  const of = <T extends { kidId: unknown }>(rows: T[], kidId: unknown) => rows.filter((r) => String(r.kidId) === String(kidId));
  const nameOf = new Map(kids.map((k) => [String(k._id), k.firstName as string]));
  const address = fam.deliveryAddressEnc ? unsealJson<DeliveryAddress>(fam.deliveryAddressEnc, fid, ADDRESS_KEY) : null;
  const notify = Object.fromEntries(NOTIFY_KINDS.map((k) => [k, fam.notify?.[k] !== false])); // missing = ON

  return {
    exportedAt: new Date(),
    parent: { email: user.email, name: user.name ?? null, language: user.locale ?? "en", accountCreated: user.createdAt ?? null, lastSignIn: user.lastLoginAt ?? null, status: user.status },
    payments: payments.map((pm) => ({
      purpose: pm.purpose,
      status: pm.status,
      amountCents: pm.amountCents,
      currency: pm.currency,
      paidAt: pm.succeededAt ?? null,
      refundedCents: pm.refundedCents ?? 0,
      children: [...(pm.kidId ? [pm.kidId] : []), ...(pm.kidIds ?? [])].map((id) => nameOf.get(String(id)) ?? "").filter(Boolean),
    })),
    family: {
      familyName: fam.familyName,
      publicAlias: fam.alias ?? null,
      aliasReview: fam.aliasReview ?? null,
      showAliasPublicly: fam.showAliasPublicly === true,
      zip: fam.zip ?? null,
      emailSettings: notify,
      deliveryAddress: address,
      deliveryAddressUnreadable: Boolean(fam.deliveryAddressEnc) && !address,
      deliveryAddressUpdatedAt: fam.deliveryAddressUpdatedAt ?? null,
      consent: { version: fam.consent?.version ?? null, acceptedAt: fam.consent?.acceptedAt ?? null, emailVerifiedAt: fam.consent?.emailVerifiedAt ?? null },
      pinSet: Boolean(fam.parentPinHash),
    },
    children: kids.map((k) => ({
      firstName: k.firstName,
      displayName: k.displayName,
      birthYear: k.birthYear,
      registered: k.registration?.status === "registered",
      registeredAt: k.registration?.registeredAt ?? null,
      registrationMethod: k.registration?.method ?? null,
      giftLimit: k.itemCap ?? 5,
      archivedAt: k.archivedAt ?? null,
      christmasMagic: { availableCentipoints: k.availableCentipoints ?? 0, heldForGiftsCentipoints: k.escrowedCentipoints ?? 0 },
      wishList: of(gifts, k._id).map((g) => ({
        gift: itemName.get(String(g.itemId)) ?? "",
        status: g.status,
        costCentipoints: g.costCentipoints,
        fundedCentipoints: g.fundedCentipoints,
        addedAt: g.createdAt,
        fullyFundedAt: g.fullyFundedAt ?? null,
        securedAt: g.lockedAt ?? null,
        shippedAt: g.shippedAt ?? null,
        trackingNote: g.trackingNote ?? null,
        receivedAt: g.receivedAt ?? null,
        deliveredAt: g.deliveredAt ?? null,
        substituteNote: g.substituteNote ?? null,
        droppedAt: g.forfeitedAt ?? null,
        droppedCentipoints: g.forfeitedCentipoints ?? null,
      })),
      goodDeeds: of(deeds, k._id).map((d) => ({
        deed: (d.deedTypeId && deedTitle.get(String(d.deedTypeId))) || "",
        ownWords: d.customDescription ?? null,
        ownWordsReview: d.customReview ?? null,
        status: d.status,
        outcome: d.outcome ?? null,
        tipCents: d.tipCents ?? null,
        recordedAt: d.createdAt,
        confirmedAt: d.confirmedAt ?? null,
        codeExpiresAt: d.expiresAt ?? null,
      })),
      votes: of(votes, k._id).map((v) => ({ day: v.day, vote: v.vote })),
      magicHistory: of(ledger, k._id).map((t) => ({ type: t.type, centipoints: t.amountCentipoints, at: t.createdAt, note: t.note ?? null })),
    })),
  };
}
