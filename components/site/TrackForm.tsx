"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function TrackForm() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [phone, setPhone] = useState("");
  const ready = id.trim().length >= 4 && phone.replace(/\D/g, "").length >= 10;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (ready) router.push(`/account?o=${encodeURIComponent(id.trim())}&p=${encodeURIComponent(phone.replace(/\D/g, "").slice(-10))}`); }}
      className="bg-white rounded-2xl shadow-card p-6 space-y-3"
    >
      <div>
        <label className="block text-xs font-medium text-ink mb-1">Order ID</label>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Order ID or invoice no. from your confirmation"
          className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald" />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink mb-1">Phone number</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="10-digit number used on the order"
          className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald" />
      </div>
      <button disabled={!ready} className="btn-primary w-full py-3 text-sm font-medium disabled:opacity-50">Track order</button>
    </form>
  );
}
