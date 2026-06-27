"use client";
import { useState } from "react";
import { decideSubmissionAction } from "@/app/actions/submissions";

type Category = { id: string; name: string };
type Sub = {
  id: string;
  channel: string;
  submitter_name: string | null;
  submitter_phone: string | null;
  submitter_email: string | null;
  product_name: string;
  category_id: string | null;
  category_other: string | null;
  description: string | null;
  color: string | null;
  qty: number;
  image_path: string | null;
  category?: { name: string } | null;
};

/** One pending submission with inline approve / reject controls. */
export function SubmissionRow({ sub, categories, money }: { sub: Sub; categories: Category[]; money: string }) {
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [categoryId, setCategoryId] = useState(sub.category_id ?? "");

  async function decide(decision: "approve" | "reject") {
    if (decision === "approve" && !categoryId) {
      setErr("Pick a category before approving.");
      return;
    }
    setBusy(decision);
    setErr("");
    const fd = new FormData();
    fd.set("id", sub.id);
    fd.set("decision", decision);
    fd.set("note", note);
    fd.set("categoryId", categoryId);
    const res = await decideSubmissionAction(fd);
    setBusy("");
    if (!res.ok) setErr(res.error ?? "Something went wrong.");
    // On success the server revalidates the page and the row moves to "Reviewed".
  }

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm">
      <div className="flex gap-4">
        {sub.image_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sub.image_path} alt={sub.product_name} className="w-24 h-24 rounded-lg object-cover bg-diva-cream shrink-0" />
        ) : (
          <div className="w-24 h-24 rounded-lg bg-diva-cream grid place-items-center text-diva-ink/30 text-2xl shrink-0">◇</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-diva-ink">{sub.product_name}</p>
            <span className={`px-2 py-0.5 rounded-full text-[11px] shrink-0 ${sub.channel === "wholesale" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{sub.channel}</span>
          </div>
          <p className="text-sm text-diva-ink/70 mt-0.5">
            {money}
            {sub.qty ? ` · ${sub.qty} pc(s)` : ""}
            {sub.color ? ` · ${sub.color}` : ""}
          </p>
          <p className="text-xs text-diva-ink/50 mt-1">
            {sub.submitter_name || "—"}
            {sub.submitter_phone ? ` · ${sub.submitter_phone}` : ""}
            {sub.submitter_email ? ` · ${sub.submitter_email}` : ""}
          </p>
          {(sub.category?.name || sub.category_other) && (
            <p className="text-xs text-diva-ink/50">Suggested: {sub.category?.name || sub.category_other}</p>
          )}
          {sub.description && <p className="text-sm text-diva-ink/70 mt-2">{sub.description}</p>}
        </div>
      </div>

      <div className="mt-4 border-t border-diva-ink/10 pt-3 flex flex-wrap items-center gap-2">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-lg border border-diva-ink/15 px-3 py-1.5 text-sm"
          title="Catalogue category for the new product"
        >
          <option value="">Category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="flex-1 min-w-[8rem] rounded-lg border border-diva-ink/15 px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => decide("approve")}
          disabled={!!busy}
          className="px-4 py-1.5 rounded-full bg-green-600 text-white text-sm disabled:opacity-50"
        >
          {busy === "approve" ? "Approving…" : "Approve → draft"}
        </button>
        <button
          onClick={() => decide("reject")}
          disabled={!!busy}
          className="px-4 py-1.5 rounded-full bg-diva-ink/10 text-diva-ink text-sm disabled:opacity-50"
        >
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
    </div>
  );
}
