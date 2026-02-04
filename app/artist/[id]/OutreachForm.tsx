"use client";

import { useActionState } from "react";
import { setOutreachAction, type OutreachFormState } from "./actions";

const OUTREACH_STATUSES = [
  "not_started",
  "contacted",
  "replied",
  "declined",
  "converted",
] as const;

export type OutreachInitial = {
  status: string;
  contact_email: string | null;
  contact_other: string | null;
  readiness: boolean;
};

export function OutreachForm({
  artistId,
  initial,
}: {
  artistId: number;
  initial: OutreachInitial | null;
}) {
  const [state, formAction] = useActionState<OutreachFormState | null, FormData>(
    setOutreachAction,
    null
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="artistId" value={artistId} />

      <label className="text-xs text-stone-500">
        Status
        <select
          name="status"
          defaultValue={initial?.status ?? "not_started"}
          className="mt-1 block w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
        >
          {OUTREACH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-stone-500">
        Contact email
        <input
          type="text"
          name="contact_email"
          defaultValue={initial?.contact_email ?? ""}
          placeholder="email@example.com"
          className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
        />
      </label>

      <label className="text-xs text-stone-500">
        Contact other (links, social)
        <input
          type="text"
          name="contact_other"
          defaultValue={initial?.contact_other ?? ""}
          placeholder="URL or note"
          className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="readiness"
          value="1"
          defaultChecked={initial?.readiness ?? false}
          className="rounded border-stone-300"
        />
        Ready for outreach
      </label>

      <button
        type="submit"
        className="w-fit rounded bg-stone-800 px-3 py-1.5 text-sm text-white hover:bg-stone-700"
      >
        Save outreach
      </button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
