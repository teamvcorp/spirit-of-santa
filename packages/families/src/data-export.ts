/**
 * "What we store about your family" (Phase 8 slice 2b, COPPA: a parent may REVIEW everything held about their
 * child, and take a copy). SERVER-ONLY. ONE function feeds both the page and the JSON download, so they can never
 * disagree.
 *
 * Teaching note — what is deliberately NOT included: password/PIN hashes, login counters, MFA secrets, link
 * tokens, encrypted blobs (the address is shown DECRYPTED instead), internal ids of other people (stores' staff,
 * admins), and visitors' data (donors' details belong to the donors). Everything else about this family is here.
 */
import "server-only";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { unsealJson } from "@repo/auth/sealed";
import { Deed, DeedType, Family, Item, Kid, KidVote, Transaction, trusted, User, WishListItem } from "@repo/db";
import type { DeliveryAddress } from "@repo/lib/address";
import { NOTIFY_KINDS } from "@repo/lib/notify";
import { ADDRESS_KEY } from "@repo/wishlists/delivery";

export type KidExport = {
  firstName: string;
  displayName: string;
  birthYear: number;
  registered: boolean;
  registeredAt: Date | null;
  christmasMagic: { availableCentipoints: number; heldForGiftsCentipoints: number };
  wishList: { gift: string; status: string; costCentipoints: number; fundedCentipoints: number; addedAt: Date }[];
  goodDeeds: { deed: string; ownWords: string | null; status: string; tipCents: number | null; recordedAt: Date }[];
  votes: { day: string; vote: string }[];
  magicHistory: { type: string; centipoints: number; at: Date }[];
};

export type FamilyExport = {
  exportedAt: Date;
  parent: { email: string; name: string | null; language: string; accountCreated: Date | null };
  family: {
    familyName: string;
    publicAlias: string | null;
    showAliasPublicly: boolean;
    zip: string | null;
    emailSettings: Record<string, boolean>;
    deliveryAddress: DeliveryAddress | null;
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
    User.findById(parent.id).select("email name locale createdAt").lean<{ email: string; name?: string; locale?: string; createdAt?: Date }>(),
    Family.findById(fid)
      .select("familyName alias showAliasPublicly zip notify consent +deliveryAddressEnc +parentPinHash")
      .lean<{ familyName: string; alias?: string; showAliasPublicly?: boolean; zip?: string; notify?: Record<string, unknown>; consent?: { version?: string; acceptedAt?: Date; emailVerifiedAt?: Date }; deliveryAddressEnc?: string; parentPinHash?: string }>(),
    Kid.find({ familyId: fid }).sort({ createdAt: 1 }).lean(),
  ]);
  if (!user || !fam) return null;
  const kidIds = kids.map((k) => k._id);
  const [gifts, deeds, votes, ledger] = await Promise.all([
    WishListItem.find({ kidId: trusted({ $in: kidIds }) }).select("kidId itemId status costCentipoints fundedCentipoints createdAt").sort({ createdAt: 1 }).lean(),
    Deed.find({ kidId: trusted({ $in: kidIds }) }).select("kidId deedTypeId customDescription status tipCents createdAt").sort({ createdAt: 1 }).lean(),
    KidVote.find({ kidId: trusted({ $in: kidIds }) }).select("kidId day vote").sort({ day: 1 }).lean(),
    Transaction.find({ kidId: trusted({ $in: kidIds }) }).select("kidId type amountCentipoints createdAt").sort({ createdAt: 1 }).lean(),
  ]);
  const [items, deedTypes] = await Promise.all([
    Item.find({ _id: trusted({ $in: [...new Set(gifts.map((g) => String(g.itemId)))] }) }).select("name").lean(),
    DeedType.find({ _id: trusted({ $in: [...new Set(deeds.filter((d) => d.deedTypeId).map((d) => String(d.deedTypeId)))] }) }).select("title").lean(),
  ]);
  const itemName = new Map(items.map((i) => [String(i._id), i.name as string]));
  const deedTitle = new Map(deedTypes.map((d) => [String(d._id), titleOf(d.title as Localized, locale)]));
  const of = <T extends { kidId: unknown }>(rows: T[], kidId: unknown) => rows.filter((r) => String(r.kidId) === String(kidId));
  const notify = Object.fromEntries(NOTIFY_KINDS.map((k) => [k, fam.notify?.[k] !== false])); // missing = ON

  return {
    exportedAt: new Date(),
    parent: { email: user.email, name: user.name ?? null, language: user.locale ?? "en", accountCreated: user.createdAt ?? null },
    family: {
      familyName: fam.familyName,
      publicAlias: fam.alias ?? null,
      showAliasPublicly: fam.showAliasPublicly === true,
      zip: fam.zip ?? null,
      emailSettings: notify,
      deliveryAddress: fam.deliveryAddressEnc ? unsealJson<DeliveryAddress>(fam.deliveryAddressEnc, fid, ADDRESS_KEY) : null,
      consent: { version: fam.consent?.version ?? null, acceptedAt: fam.consent?.acceptedAt ?? null, emailVerifiedAt: fam.consent?.emailVerifiedAt ?? null },
      pinSet: Boolean(fam.parentPinHash),
    },
    children: kids.map((k) => ({
      firstName: k.firstName,
      displayName: k.displayName,
      birthYear: k.birthYear,
      registered: k.registration?.status === "registered",
      registeredAt: k.registration?.registeredAt ?? null,
      christmasMagic: { availableCentipoints: k.availableCentipoints ?? 0, heldForGiftsCentipoints: k.escrowedCentipoints ?? 0 },
      wishList: of(gifts, k._id).map((g) => ({ gift: itemName.get(String(g.itemId)) ?? "", status: g.status, costCentipoints: g.costCentipoints, fundedCentipoints: g.fundedCentipoints, addedAt: g.createdAt })),
      goodDeeds: of(deeds, k._id).map((d) => ({ deed: (d.deedTypeId && deedTitle.get(String(d.deedTypeId))) || "", ownWords: d.customDescription ?? null, status: d.status, tipCents: d.tipCents ?? null, recordedAt: d.createdAt })),
      votes: of(votes, k._id).map((v) => ({ day: v.day, vote: v.vote })),
      magicHistory: of(ledger, k._id).map((t) => ({ type: t.type, centipoints: t.amountCentipoints, at: t.createdAt })),
    })),
  };
}
