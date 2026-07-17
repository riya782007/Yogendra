/**
 * lib/xlsxTemplate.ts — builds the BlytheDIVA bulk-product Excel template IN THE BROWSER, with native
 * Excel data-validation DROPDOWNS for Type / Category / Subcategory / Style / Polish so employees pick
 * values instead of typing them (no misspellings). No dependency: we hand-write the OOXML parts and
 * pack them into a STORE-only .xlsx zip. Validated to open cleanly in Excel / openpyxl.
 */

const enc = (s: string) => new TextEncoder().encode(s);

/** CRC-32 (needed even for stored/uncompressed zip entries). */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal STORE-method (no compression) zip — valid for .xlsx. */
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const f of files) {
    const name = enc(f.name);
    const crc = crc32(f.data);
    const sz = f.data.length;
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(sz), ...u32(sz), ...u16(name.length), ...u16(0),
    ];
    parts.push(Uint8Array.from(local), name, f.data);
    const cd = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(sz), ...u32(sz), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ];
    central.push(Uint8Array.from(cd), name);
    offset += local.length + name.length + sz;
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ];
  const all = [...parts, ...central, Uint8Array.from(eocd)];
  let total = 0;
  for (const a of all) total += a.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

const xesc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function sheetXml(rows: string[][], validations: { sqref: string; list: string }[]): string {
  let body = "";
  rows.forEach((r, ri) => {
    const rownum = ri + 1;
    let cells = "";
    r.forEach((val, ci) => {
      if (val === "" || val == null) return;
      const ref = colLetter(ci + 1) + rownum;
      cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(val)}</t></is></c>`;
    });
    body += `<row r="${rownum}">${cells}</row>`;
  });
  const dv = validations.length
    ? `<dataValidations count="${validations.length}">` +
      validations
        .map(
          (v) =>
            // errorStyle="information" + showErrorMessage="0": the dropdown SUGGESTS the known values
            // but NEVER blocks a new one — so an employee can type a brand-new polish/style/colour
            // (e.g. "Mehendi") right in the sheet and the import will create it. No more dead-ends.
            `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" errorStyle="information" sqref="${v.sqref}"><formula1>${xesc(v.list)}</formula1></dataValidation>`,
        )
        .join("") +
      `</dataValidations>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData>${dv}</worksheet>`;
}

export type TemplateLists = { categories: string[]; subcategories: string[]; styles: string[]; polishes: string[] };

/** Build the .xlsx bytes for the bulk-product template. */
export function buildProductTemplateXlsx(lists: TemplateLists): Uint8Array {
  const clean = (a: string[]) => Array.from(new Set((a ?? []).map((s) => (s ?? "").trim()).filter(Boolean)));
  const cats = clean(lists.categories);
  const subs = clean(lists.subcategories);
  const styles = clean(lists.styles);
  const polishes = clean(lists.polishes);
  const types = ["simple", "configurable"];

  // Products sheet: header + two worked examples + blank rows to fill.
  const header = ["name", "sku", "base_price", "qty", "type", "category", "subcategory", "style", "polish", "colours"];
  const ex1 = ["Rajwadi Kundan Necklace", "", "850", "12", "configurable", cats[0] ?? "", subs[0] ?? "", styles[0] ?? "", polishes[0] ?? "", "Red|Green|Blue"];
  const ex2 = ["Pearl Studs", "", "160", "40", "simple", cats[0] ?? "", "", "", polishes[0] ?? "", ""];
  const products: string[][] = [header, ex1, ex2];
  for (let i = 0; i < 60; i++) products.push(["", "", "", "", "", "", "", "", "", ""]);

  // Lists sheet columns: A Category, B Subcategory, C Style, D Polish, E Type.
  const listsRows: string[][] = [["Category", "Subcategory", "Style", "Polish", "Type"]];
  const maxLen = Math.max(cats.length, subs.length, styles.length, polishes.length, types.length);
  for (let i = 0; i < maxLen; i++) {
    listsRows.push([cats[i] ?? "", subs[i] ?? "", styles[i] ?? "", polishes[i] ?? "", types[i] ?? ""]);
  }

  const vlist = (col: string, len: number) => `Lists!$${col}$2:$${col}$${1 + len}`;
  const LAST = 2000; // apply dropdowns to a generous row range
  const validations: { sqref: string; list: string }[] = [];
  validations.push({ sqref: `E2:E${LAST}`, list: vlist("E", types.length) }); // type
  if (cats.length) validations.push({ sqref: `F2:F${LAST}`, list: vlist("A", cats.length) });
  if (subs.length) validations.push({ sqref: `G2:G${LAST}`, list: vlist("B", subs.length) });
  if (styles.length) validations.push({ sqref: `H2:H${LAST}`, list: vlist("C", styles.length) });
  if (polishes.length) validations.push({ sqref: `I2:I${LAST}`, list: vlist("D", polishes.length) });

  const sheet1 = sheetXml(products, validations);
  const sheet2 = sheetXml(listsRows, []);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/><sheet name="Lists" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;

  return zipStore([
    { name: "[Content_Types].xml", data: enc(contentTypes) },
    { name: "_rels/.rels", data: enc(rels) },
    { name: "xl/workbook.xml", data: enc(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(wbRels) },
    { name: "xl/worksheets/sheet1.xml", data: enc(sheet1) },
    { name: "xl/worksheets/sheet2.xml", data: enc(sheet2) },
  ]);
}

/** Build + trigger a browser download of the template. */
export function downloadProductTemplate(lists: TemplateLists, filename = "blythe-diva-products.xlsx"): void {
  const bytes = buildProductTemplateXlsx(lists);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
