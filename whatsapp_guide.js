const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, ExternalHyperlink,
} = require("docx");

const EMERALD = "0F5C4D", GOLD = "A07E2E", INK = "241B2E", MUTED = "6B6472", BOXBG = "F4F1EA", NOTEBG = "FBF3D9";

const gap = (a = 120) => new Paragraph({ spacing: { after: a }, children: [] });
function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 },
    children: [new TextRun({ text, bold: true, size: 30, color: EMERALD, font: "Calibri" })] });
}
function h2(text) {
  return new Paragraph({ spacing: { before: 200, after: 90 },
    children: [new TextRun({ text, bold: true, size: 24, color: INK, font: "Calibri" })] });
}
function body(runs, opts = {}) {
  const arr = Array.isArray(runs) ? runs : [new TextRun({ text: runs, size: 21, color: INK, font: "Calibri" })];
  return new Paragraph({ spacing: { after: opts.after ?? 100 }, children: arr, ...opts });
}
function bullet(text) {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 },
    children: [new TextRun({ text, size: 21, color: INK, font: "Calibri" })] });
}
function link(text, url) {
  return new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: "Hyperlink", size: 21, font: "Calibri" })] });
}
function copyBox(lines, label) {
  const kids = [];
  if (label) kids.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: label, bold: true, italics: true, size: 17, color: GOLD, font: "Calibri" })] }));
  lines.forEach((ln, i) => kids.push(new Paragraph({ spacing: { after: i === lines.length - 1 ? 0 : 40 },
    children: [new TextRun({ text: ln, size: 21, color: INK, font: "Calibri" })] })));
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    borders: { top: { style: BorderStyle.SINGLE, size: 4, color: GOLD }, bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD },
      left: { style: BorderStyle.SINGLE, size: 16, color: GOLD }, right: { style: BorderStyle.SINGLE, size: 4, color: GOLD },
      insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [new TableRow({ children: [new TableCell({ width: { size: 9360, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: BOXBG }, margins: { top: 120, bottom: 120, left: 160, right: 160 }, children: kids })] })] });
}
function noteBox(titleText, lines) {
  const kids = [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: titleText, bold: true, size: 21, color: INK, font: "Calibri" })] })];
  lines.forEach((ln) => kids.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: ln, size: 20, color: INK, font: "Calibri" })] })));
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
    borders: { top: { style: BorderStyle.SINGLE, size: 4, color: GOLD }, bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD },
      left: { style: BorderStyle.SINGLE, size: 4, color: GOLD }, right: { style: BorderStyle.SINGLE, size: 4, color: GOLD },
      insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [new TableRow({ children: [new TableCell({ width: { size: 9360, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: NOTEBG }, margins: { top: 120, bottom: 120, left: 160, right: 160 }, children: kids })] })] });
}
function qrTable(rows) {
  const headerRow = new TableRow({ tableHeader: true, children: [
    new TableCell({ width: { size: 1900, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: EMERALD }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: "Shortcut", bold: true, color: "FFFFFF", size: 20, font: "Calibri" })] })] }),
    new TableCell({ width: { size: 7460, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: EMERALD }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: "Message (copy this)", bold: true, color: "FFFFFF", size: 20, font: "Calibri" })] })] }),
  ] });
  const dataRows = rows.map(([sc, lines], idx) => new TableRow({ children: [
    new TableCell({ width: { size: 1900, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: idx % 2 ? "FFFFFF" : BOXBG }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: sc, bold: true, color: GOLD, size: 20, font: "Consolas" })] })] }),
    new TableCell({ width: { size: 7460, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: idx % 2 ? "FFFFFF" : BOXBG }, margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: lines.map((ln, i) => new Paragraph({ spacing: { after: i === lines.length - 1 ? 0 : 30 }, children: [new TextRun({ text: ln, size: 20, color: INK, font: "Calibri" })] })) }),
  ] }));
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [1900, 7460],
    borders: { top: { style: BorderStyle.SINGLE, size: 2, color: "D8D2C4" }, bottom: { style: BorderStyle.SINGLE, size: 2, color: "D8D2C4" },
      left: { style: BorderStyle.SINGLE, size: 2, color: "D8D2C4" }, right: { style: BorderStyle.SINGLE, size: 2, color: "D8D2C4" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "D8D2C4" }, insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "D8D2C4" } },
    rows: [headerRow, ...dataRows] });
}

const children = [];
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 40 }, children: [new TextRun({ text: "BLYTHE DIVA", bold: true, size: 52, color: EMERALD, font: "Calibri" })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 30 }, children: [new TextRun({ text: "WhatsApp Business — Complete Setup Guide", size: 26, color: GOLD, font: "Calibri" })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Copy-paste ready · Profile · Greeting · Away · Quick replies · Labels · Catalog · Automations", italics: true, size: 18, color: MUTED, font: "Calibri" })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 8 } }, spacing: { after: 200 }, children: [] }));

children.push(noteBox("First, one important thing — use ONE phone number everywhere", [
  "Your WhatsApp Business app is on +91 95820 02623, but the website's WhatsApp button currently links to +91 98731 51767.",
  "Customers who tap WhatsApp on blythediva.com will reach a DIFFERENT number than your business profile / catalog.",
  "Pick ONE number as the official Blythe Diva WhatsApp, set up the profile on THAT number, and tell us which one — we'll make the website, invoices and links all point to it. Everything below assumes your chosen business number.",
]));
children.push(gap(160));

children.push(h1("1) Business Profile  (Tools -> Profile / Business info)"));
children.push(body("Fill each field exactly as below. This is what customers see when they tap your business name — a complete profile builds instant trust."));
children.push(h2("Business name"));
children.push(copyBox(["Blythe Diva"]));
children.push(h2("Category"));
children.push(copyBox(["Jewelry / Jewellery Store"]));
children.push(h2("Business description / About"));
children.push(copyBox(["Blythe Diva 💎 Premium anti-tarnish artificial jewellery, direct from our Sadar Bazar (Delhi) factory. Necklaces, earrings, bracelets, anklets, rings & watches. Retail & Wholesale. COD available • ₹80 flat shipping • 7-day returns. Shop 24×7 -> blythediva.com"], "Paste into 'Description' (fits WhatsApp's 256-character limit)"));
children.push(h2("Address"));
children.push(copyBox(["Blythe Diva (Yogendra Industries), 5150-B, Rui Mandi, Sadar Bazar, Delhi-110006"]));
children.push(h2("Business hours"));
children.push(body("Set these (adjust to your real timing) — customers rely on this to know when you'll reply:"));
children.push(copyBox(["Monday – Saturday: 10:00 AM – 7:00 PM", "Sunday: Closed", "(Website takes orders 24×7)"]));
children.push(h2("Email"));
children.push(copyBox(["hello@blythediva.in"]));
children.push(h2("Websites (you can add up to 2)"));
children.push(copyBox(["https://blythediva.com", "https://blythediva.com/trade"], "Website 1 = retail shop · Website 2 = wholesale / dealer portal"));
children.push(body([new TextRun({ text: "Profile photo: ", bold: true, size: 21, color: INK, font: "Calibri" }), new TextRun({ text: "use the Blythe Diva logo (round). ", size: 21, color: INK, font: "Calibri" }), new TextRun({ text: "Cover photo: ", bold: true, size: 21, color: INK, font: "Calibri" }), new TextRun({ text: "a clean shot of your best-selling set on a plain background.", size: 21, color: INK, font: "Calibri" })]));

children.push(h1("2) Greeting Message  (Tools -> Greeting message)"));
children.push(body("Turn it ON and set 'Recipients: Everyone'. It auto-sends the first time a customer messages, or after 14 days of no chat."));
children.push(copyBox([
  "Hi! 🙏 Welcome to Blythe Diva 💎",
  "Premium anti-tarnish artificial jewellery, straight from our Sadar Bazar (Delhi) factory.",
  "Tell us what you're looking for — necklace, earrings, bracelet, anklet, ring or watch — and we'll help you right away! ✨",
  "🛍️ Browse & order anytime: blythediva.com",
], "Copy -> Greeting message"));

children.push(h1("3) Away Message  (Tools -> Away message)"));
children.push(body("Turn it ON and set schedule 'Outside business hours' (using the hours above). Auto-replies when you're not available so no lead feels ignored."));
children.push(copyBox([
  "Thank you for messaging Blythe Diva 💎",
  "We're away right now but will reply as soon as we're back (Mon–Sat, 10 AM – 7 PM). 🙏",
  "Meanwhile you can browse our full collection and order 24×7 👉 blythediva.com",
  "For wholesale / bulk (shopkeepers & resellers): blythediva.com/trade",
], "Copy -> Away message"));

children.push(h1("4) Quick Replies  (Tools -> Quick replies)"));
children.push(body([new TextRun({ text: "Add each of these. In any chat, type ", size: 21, color: INK, font: "Calibri" }), new TextRun({ text: "/", bold: true, size: 21, color: GOLD, font: "Consolas" }), new TextRun({ text: " then the shortcut and the full message appears instantly — reply to common questions in one tap.", size: 21, color: INK, font: "Calibri" })]));
children.push(gap(60));
children.push(qrTable([
  ["/price", ["Our prices depend on the design 💎 Send me the item or a photo you like and I'll share the exact rate. You can also see live prices here: blythediva.com"]],
  ["/catalog", ["Here's our full collection 👇 (new designs added every week)", "🛍️ Retail: blythediva.com", "🏬 Wholesale / dealers: blythediva.com/trade"]],
  ["/shipping", ["📦 Flat ₹80 shipping anywhere in India. Orders dispatched within 1–2 working days. COD also available."]],
  ["/cod", ["✅ Yes, Cash on Delivery is available! A small ₹120 handling fee applies. (COD up to ₹5,000; above that, easy online payment.)"]],
  ["/payment", ["Pay easily online — UPI, Credit/Debit card, Netbanking or Wallet 💳", "Or just order on blythediva.com and pay securely at checkout."]],
  ["/upi", ["You can pay via UPI to: [ADD-YOUR-UPI-ID] (Blythe Diva / Yogendra Industries). Please share a screenshot after paying 🙏"]],
  ["/wholesale", ["🏬 We supply wholesale / bulk to shops & resellers, direct from our Sadar Bazar factory.", "See dealer rates & order: blythediva.com/trade", "Shipping: ₹300–₹900 by order value; above ₹30,000 quoted separately."]],
  ["/order", ["To order, just send me the design photo / SKU + quantity, or order directly on blythediva.com 🛍️ We'll confirm and dispatch quickly!"]],
  ["/returns", ["🔄 Easy 7-day returns on unused pieces in original packing. Message us with your order number and we'll help."]],
  ["/timing", ["🕙 Open Mon–Sat, 10:00 AM – 7:00 PM. The website blythediva.com takes orders 24×7."]],
  ["/address", ["📍 Blythe Diva (Yogendra Industries), 5150-B, Rui Mandi, Sadar Bazar, Delhi-110006. Wholesale visitors welcome!"]],
  ["/gift", ["🎁 Order online & pay in advance to get a FREE mystery gift with your order! Shop now: blythediva.com"]],
  ["/track", ["Please share your order number and I'll check the dispatch / delivery status for you right away 🚚"]],
  ["/thanks", ["Thank you for shopping with Blythe Diva 💛 We'd love to see you again! Save our number & check our Status for new arrivals."]],
]));
children.push(gap(60));
children.push(body([new TextRun({ text: "Remember to replace [ADD-YOUR-UPI-ID] in /upi and /payment with your real UPI ID before saving.", italics: true, size: 19, color: GOLD, font: "Calibri" })]));

children.push(h1("5) Lists & Labels — organise every chat  (Tools -> Lists)"));
children.push(body("Create these labels and tag each chat. One glance tells you who's a fresh lead, who owes money, and what's dispatched. This is how you never lose an order."));
children.push(qrTable([
  ["New Enquiry", ["A new customer just messaged — not yet quoted / ordered."]],
  ["Retail Order", ["Retail order placed / being processed."]],
  ["Wholesale/Dealer", ["A shopkeeper or reseller — bulk buyer."]],
  ["Payment Pending", ["Order confirmed, money not yet received (udhaar / credit)."]],
  ["Paid", ["Payment received in full."]],
  ["Dispatched", ["Parcel handed to courier."]],
  ["Delivered", ["Order delivered & closed."]],
  ["VIP / Repeat", ["Loyal / high-value buyer — give priority."]],
  ["Follow-up", ["Interested but didn't buy — message again in a few days."]],
]));

children.push(h1("6) Catalog — show products right inside WhatsApp"));
children.push(body("Your website IS your full live catalog, but adding your top sellers to the WhatsApp catalog lets customers browse without leaving the chat."));
children.push(bullet("Tools -> Catalog -> Add item. For each: add a clear photo, name, price, and in the 'Link' field paste that product's page from blythediva.com."));
children.push(bullet("Start with your 10–15 best-selling designs; add more over time."));
children.push(bullet("In any chat you can then tap '+' -> Catalog to send products instantly."));
children.push(bullet("Also share the full shop link (blythediva.com) and, for dealers, the wholesale line-sheet PDF (in Section 8)."));

children.push(h1("7) Every automation available (free WhatsApp Business app)"));
children.push(bullet("Greeting message — auto-welcomes every new customer (Section 2)."));
children.push(bullet("Away message — auto-replies outside your hours (Section 3)."));
children.push(bullet("Quick replies — one-tap answers to FAQs (Section 4)."));
children.push(bullet("Labels / Lists — organise & track every order stage (Section 5)."));
children.push(bullet("Catalog — in-chat product browsing (Section 6)."));
children.push(bullet("Click-to-chat link & QR — put your WhatsApp one tap away everywhere (Section 8)."));
children.push(bullet("Broadcast lists — send a new-arrival or festive offer to many saved customers at once (they must have your number saved). Great for repeat sales — use once or twice a week, not daily."));
children.push(bullet("Status updates — post new designs daily like a story; customers who have your number see them and reply to buy."));
children.push(body([new TextRun({ text: "Want more? ", bold: true, size: 21, color: INK, font: "Calibri" }), new TextRun({ text: "A full auto-reply bot (answers 24×7, takes orders automatically, sends payment links) is possible later via the WhatsApp Business API / your website — ask us when you're ready to scale.", size: 21, color: INK, font: "Calibri" })]));

children.push(h1("8) Your links & assets (share these everywhere)"));
children.push(body([new TextRun({ text: "Retail shop: ", bold: true, size: 21, color: INK, font: "Calibri" }), link("https://blythediva.com", "https://blythediva.com")]));
children.push(body([new TextRun({ text: "Wholesale / dealer portal: ", bold: true, size: 21, color: INK, font: "Calibri" }), link("https://blythediva.com/trade", "https://blythediva.com/trade")]));
children.push(body([new TextRun({ text: "Wholesale line-sheet (PDF for dealers): ", bold: true, size: 21, color: INK, font: "Calibri" }), link("https://blythediva.com/trade/line-sheet", "https://blythediva.com/trade/line-sheet")]));
children.push(body([new TextRun({ text: "Click-to-chat link (put in bio / posts / status):", bold: true, size: 21, color: INK, font: "Calibri" })]));
children.push(copyBox(["https://wa.me/91XXXXXXXXXX   <- replace XXXXXXXXXX with your chosen 10-digit WhatsApp number", "(example: https://wa.me/919582002623)"], "Anyone who taps this opens a chat with you instantly"));
children.push(bullet("QR code: WhatsApp Business -> Tools -> Short link -> 'View QR code'. Print it for your shop counter, visiting card, and parcels."));
children.push(bullet("Add the click-to-chat link to your Instagram & Facebook bio (Tools -> Instagram & Facebook to connect them)."));

children.push(h1("9) Pro tips to get the most out of it"));
children.push(bullet("Reply fast — even a quick 'Ji, checking!' keeps the lead warm. The greeting / away messages buy you time."));
children.push(bullet("Label every chat the moment it comes in — 2 seconds now saves a lost order later."));
children.push(bullet("Post new designs on Status daily — it's free advertising to everyone who saved your number."));
children.push(bullet("Use Broadcast for offers / new stock, but sparingly (1–2x/week) so people don't mute you."));
children.push(bullet("Keep the catalog fresh — remove sold-out designs, add new ones weekly."));
children.push(bullet("Always send the payment / UPI quick reply + ask for a screenshot, then label 'Paid'."));
children.push(bullet("Print your WhatsApp QR on every parcel — turns one-time buyers into repeat customers."));

children.push(gap(160));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 8, color: GOLD, space: 8 } }, spacing: { before: 120 }, children: [new TextRun({ text: "Prepared for Blythe Diva · Yogendra Industries, Sadar Bazar, Delhi  ·  by Newvora", italics: true, size: 17, color: MUTED, font: "Calibri" })] }));

const doc = new Document({
  creator: "Newvora", title: "Blythe Diva — WhatsApp Business Setup Guide",
  styles: { default: { document: { run: { font: "Calibri", size: 21, color: INK } } } },
  sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1040, right: 1040 } } }, children }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(process.argv[2] || "guide.docx", buf); console.log("written", buf.length, "bytes"); });
