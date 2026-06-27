"use client";
import { useRef, useState } from "react";
import { submitProductAction } from "@/app/actions/submissions";

type Category = { id: string; name: string };

/**
 * Reusable "Sell with us" submission form. Used on:
 *   - the public storefront /sell page (channel="retail")
 *   - the wholesale trade panel (channel="wholesale", contact prefilled & locked)
 *
 * Submits a real FormData (so the photo File reaches the server action) to
 * submitProductAction, which stores it as a pending submission for the owner to review.
 */
export function SellForm({
  categories,
  channel = "retail",
  defaultName = "",
  lockedContact = false,
}: {
  categories: Category[];
  channel?: "retail" | "wholesale";
  defaultName?: string;
  lockedContact?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [fileName, setFileName] = useState("");

  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald";
  const label = "block text-xs font-medium text-ink/70 mb-1";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const fd = new FormData(e.currentTarget);
    fd.set("channel", channel);
    const res = await submitProductAction(fd);
    setBusy(false);
    if (res.ok) {
      setDone(true);
      formRef.current?.reset();
      setFileName("");
    } else {
      setErr(res.error ?? "Couldn't submit — please try again.");
    }
  }

  if (done)
    return (
      <div className="text-center py-8">
        <p className="text-5xl">📦</p>
        <h2 className="font-display text-2xl text-ink mt-2">Submission received!</h2>
        <p className="text-sm text-muted mt-1 max-w-md mx-auto">
          Thank you — our team will review your product and get in touch about pricing and next steps.
          {channel === "wholesale" ? " You can track status with our buying team." : ""}
        </p>
        <button onClick={() => setDone(false)} className="btn-primary mt-5 px-6 py-2.5 text-sm font-medium">
          Submit another product
        </button>
      </div>
    );

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      {/* Contact details */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={label}>Your name {channel === "retail" && <span className="text-rose">*</span>}</label>
          <input
            name="name"
            defaultValue={defaultName}
            readOnly={lockedContact}
            placeholder="e.g. Priya Sharma"
            className={`${input} ${lockedContact ? "bg-cream/60 text-ink/70" : ""}`}
          />
        </div>
        <div>
          <label className={label}>Phone {channel === "retail" && <span className="text-rose">*</span>}</label>
          <input
            name="phone"
            readOnly={lockedContact}
            placeholder="10-digit mobile"
            className={`${input} ${lockedContact ? "bg-cream/60 text-ink/70" : ""}`}
          />
          {lockedContact && <p className="text-[11px] text-muted mt-1">We'll use the phone on your trade account.</p>}
        </div>
      </div>
      <div>
        <label className={label}>Email (optional)</label>
        <input name="email" type="email" placeholder="you@example.com" className={input} />
      </div>

      {/* Product details */}
      <div className="border-t border-sand pt-4 space-y-4">
        <div>
          <label className={label}>Product name <span className="text-rose">*</span></label>
          <input name="productName" placeholder="e.g. Kundan Choker Set" className={input} required />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={label}>Category</label>
            <select name="categoryId" className={input} defaultValue="">
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Or tell us the type</label>
            <input name="categoryOther" placeholder="e.g. Anklets (if not listed)" className={input} />
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className={label}>Your price (₹) <span className="text-rose">*</span></label>
            <input name="askingPrice" type="number" min={1} step="1" inputMode="numeric" placeholder="e.g. 450" className={input} required />
          </div>
          <div>
            <label className={label}>Quantity available</label>
            <input name="qty" type="number" min={0} step="1" inputMode="numeric" placeholder="e.g. 25" className={input} />
          </div>
          <div>
            <label className={label}>Colour (optional)</label>
            <input name="color" placeholder="e.g. Gold" className={input} />
          </div>
        </div>
        <div>
          <label className={label}>Description</label>
          <textarea name="description" rows={3} placeholder="Material, size, finish, anything that helps us evaluate it…" className={input} />
        </div>
        <div>
          <label className={label}>Photo (optional, recommended)</label>
          <label className="flex items-center gap-3 rounded-xl border border-dashed border-sand px-4 py-3 text-sm text-muted cursor-pointer hover:border-emerald">
            <span className="px-3 py-1.5 rounded-full bg-cream text-ink/80 text-xs font-medium">Choose photo</span>
            <span className="truncate">{fileName || "JPG / PNG — a clear shot of the piece"}</span>
            <input
              name="image"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            />
          </label>
        </div>
      </div>

      {err && <p className="text-sm text-rose">{err}</p>}
      <button disabled={busy} className="btn-primary w-full py-3 text-sm font-medium disabled:opacity-50">
        {busy ? "Submitting…" : "Submit product for review"}
      </button>
      <p className="text-[11px] text-muted text-center">
        Submitting doesn't list your product instantly — our team reviews every piece before it goes live.
      </p>
    </form>
  );
}
