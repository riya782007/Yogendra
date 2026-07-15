/**
 * lib/sheetImport.ts — tiny client-side helper to read a bulk file (.xlsx / .xls via SheetJS from CDN,
 * or .csv / .txt as plain text) into CSV text. Shared by the product bulk-upload and the purchase
 * bulk-entry so both accept real Excel files the same way.
 */

/** Load SheetJS from CDN on demand (no build dependency). */
export async function loadSheetJS(): Promise<any> {
  const w = window as any;
  if (w.XLSX) return w.XLSX;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the Excel reader"));
    document.head.appendChild(s);
  });
  return (window as any).XLSX;
}

/** Read a bulk file into CSV text — supports .xlsx / .xls (Excel) and .csv / .txt (plain). */
export async function fileToCsv(f: File): Promise<string> {
  if (/\.(xlsx|xls)$/i.test(f.name)) {
    const XLSX = await loadSheetJS();
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(ws);
  }
  return await f.text();
}
