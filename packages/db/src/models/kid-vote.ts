/**
 * KidVote = a parent's daily Naughty/Nice vote for one child (Phase 4 slice 5).
 * One per child per calendar day in the season time zone ("YYYY-MM-DD"); the parent can change it
 * that day. Days WITHOUT a vote count as Nice (computed, never stored), so no nightly job is needed.
 * seasonYear = Santa's LIST year (santaListYear): each list covers Dec 26 → Dec 25 (Central Time),
 * so votes from Dec 26 build next Christmas's list (user, 2026-11-06). Deleted with the child (COPPA).
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { objectId, seasonYearField } from "./_shared.ts";

import { KID_VOTES } from "@repo/lib/family";
export { KID_VOTES };

const kidVoteSchema = new Schema(
  {
    kidId: objectId("Kid"),
    familyId: objectId("Family"),
    seasonYear: seasonYearField,
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    vote: { type: String, enum: KID_VOTES, required: true },
  },
  { timestamps: true, versionKey: false },
);

kidVoteSchema.index({ kidId: 1, day: 1 }, { unique: true }); // one vote per child per day
kidVoteSchema.index({ familyId: 1, seasonYear: 1 }); // the family's tallies

export type KidVoteDoc = InferSchemaType<typeof kidVoteSchema>;
export const KidVote = (models.KidVote ?? model("KidVote", kidVoteSchema)) as Model<KidVoteDoc>;
