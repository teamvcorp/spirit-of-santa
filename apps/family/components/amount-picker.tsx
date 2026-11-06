"use client";
/**
 * Preset amounts + "Other" for tips (/d) and donations (/k). UNCONTROLLED radios (defaultChecked):
 * the parent <form> must use key={state.nonce} so this remounts with the last submitted values as
 * defaults (see lib/amount-form.ts for why). Local state only decides whether "Other" is shown.
 */
import { useState } from "react";
import { formatCents } from "@repo/lib/format";
import { TIP_PRESETS_CENTS } from "@repo/lib/limits";
import { TextField } from "@repo/ui/text-field";
import type { AmountEcho } from "../lib/amount-form";

type Props = { values: AmountEcho["values"]; initial: number; legend: string; otherLabel: string; otherAmountLabel: string };

export function AmountPicker({ values, initial, legend, otherLabel, otherAmountLabel }: Props) {
  const valid = values?.amount === "other" || (TIP_PRESETS_CENTS as readonly number[]).map(String).includes(values?.amount ?? "");
  const start = valid && values ? values.amount : String(initial);
  const [amount, setAmount] = useState(start);
  return (
    <>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="sr-only">{legend}</legend>
        {TIP_PRESETS_CENTS.map((c) => (
          <label key={c} className="flex items-center gap-2 rounded-lg border border-foreground/20 px-4 py-2">
            <input type="radio" name="amount" value={String(c)} defaultChecked={start === String(c)} onChange={() => setAmount(String(c))} />
            {formatCents(c)}
          </label>
        ))}
        <label className="flex items-center gap-2 rounded-lg border border-foreground/20 px-4 py-2">
          <input type="radio" name="amount" value="other" defaultChecked={start === "other"} onChange={() => setAmount("other")} />
          {otherLabel}
        </label>
      </fieldset>
      {amount === "other" && <TextField label={otherAmountLabel} name="other" inputMode="decimal" required maxLength={10} defaultValue={values?.other ?? ""} />}
    </>
  );
}
