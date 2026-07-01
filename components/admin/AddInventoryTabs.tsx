"use client";
import { useState } from "react";
import { AddInventoryClient } from "@/components/admin/AddInventoryClient";
import { UploadClient } from "@/components/admin/UploadClient";

type Cat = { id: string; name: string };
type Sub = { id: string; name: string; categoryId: string };
type VariantOptions = { color: string[]; size: string[]; polish: string[] };
type ColorCodeMap = Record<string, string>;

/** Add Inventory has two flows that share the same backend:
 *  • "New product" — the guided, enterprise single-product builder (mockup), wired to createProductFullAction.
 *  • "Bulk / sheet import" — the AI list importer for adding many designs at once. */
export function AddInventoryTabs(props: { categories: Cat[]; subcategories?: Sub[]; styles?: Sub[]; variantOptions: VariantOptions; colorCodes: ColorCodeMap }) {
  const [tab, setTab] = useState<"new" | "bulk">("new");
  return (
    <div>
      <div className="inline-flex rounded-full bg-cream p-1 mb-5">
        {([["new", "New product"], ["bulk", "Bulk / sheet import"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-1.5 rounded-full text-sm transition-colors ${tab === k ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>{label}</button>
        ))}
      </div>
      {tab === "new" ? (
        <AddInventoryClient categories={props.categories} subcategories={props.subcategories ?? []} styles={props.styles ?? []} variantOptions={props.variantOptions} colorCodes={props.colorCodes} />
      ) : (
        <UploadClient categories={props.categories} variantOptions={props.variantOptions} colorCodes={props.colorCodes} initialMode="bulk" />
      )}
    </div>
  );
}
