import { describe, it, expect } from "vitest";
import {
  detectLanguage, extractSku, extractQuantity, extractPriceRupees, extractColor,
  extractSubject, interpret, type DivaContext,
} from "../lib/diva/nlu";

// Helper: the tool of the first planned step.
const firstTool = (cmd: string, ctx?: DivaContext) => interpret(cmd, ctx).steps[0]?.tool;

describe("language detection", () => {
  it("plain English", () => expect(detectLanguage("show me this week's sales")).toBe("en"));
  it("Devanagari Hindi", () => expect(detectLanguage("बीस ऑक्सीडाइज़ नेकलेस का स्टॉक जोड़ो")).toBe("hi"));
  it("Hinglish (romanised)", () => expect(detectLanguage("20 oxidised necklace ka stock add kar do")).toBe("hinglish"));
  it("mixed Devanagari + latin is hinglish", () => expect(detectLanguage("BD1001 का photo dikhao")).toBe("hinglish"));
});

describe("entity extraction", () => {
  it("SKU with and without prefix word", () => {
    expect(extractSku("SKU BD1001 ka photo dikhao")).toBe("BD1001");
    expect(extractSku("hide bd 1003 please")).toBe("BD1003");
    expect(extractSku("no sku here")).toBeUndefined();
  });
  it("quantity from digits and Hindi number-words", () => {
    expect(extractQuantity("add 20 pieces")).toBe(20);
    expect(extractQuantity("bees necklace add karo")).toBe(20);
    expect(extractQuantity("pachas pieces add karo")).toBe(50);
  });
  it("Devanagari digits", () => expect(extractQuantity("२० pieces add karo")).toBe(20));
  it("price near cue", () => {
    expect(extractPriceRupees("isko 800 ka kardo")).toBe(800);
    expect(extractPriceRupees("price ₹1499")).toBe(1499);
  });
  it("colour in English and Hindi", () => {
    expect(extractColor("blue kundan necklace")).toBe("blue");
    expect(extractColor("laal choker")).toBe("red");
  });
  it("subject phrase", () => {
    expect(extractSubject("20 oxidised necklace ka stock add kar do")).toContain("oxidised necklace");
  });
});

describe("intent → tool mapping (the client's example commands)", () => {
  it("add stock by name (Hinglish)", () => {
    const p = interpret("20 oxidised necklace ka stock add kar do");
    expect(p.steps[0].tool).toBe("add_stock_by_name");
    expect(p.steps[0].args.qty).toBe(20);
  });
  it("inventory query by name", () => {
    expect(firstTool("Blue kundan necklace ka inventory kitna hai?")).toBe("inventory_of");
  });
  it("price query with 'ye product' uses memory", () => {
    const ctx: DivaContext = { lastSku: "BD1004" };
    const p = interpret("Ye product wholesale me kitne ka hai?", ctx);
    expect(p.steps[0].tool).toBe("get_price");
    expect(p.steps[0].args.sku).toBe("BD1004");
    expect(p.steps[0].args.tier).toBe("wholesale");
  });
  it("show photo for a SKU", () => {
    expect(firstTool("SKU BD1001 ka photo dikhao")).toBe("product_details");
  });
  it("share catalogue on whatsapp", () => {
    const p = interpret("Oxidised necklace ka catalog whatsapp pe bhejo");
    expect(p.steps[0].tool).toBe("share_catalog");
    expect(p.steps[0].args.whatsapp).toBe(true);
  });
  it("make a customer wholesale", () => {
    const p = interpret("Customer Ravi ko wholesale bana do");
    expect(p.steps[0].tool).toBe("set_customer_type");
    expect(p.steps[0].args.name).toBe("Ravi");
    expect(p.steps[0].args.type).toBe("wholesale");
  });
  it("pending orders", () => {
    expect(firstTool("Pending orders dikhao")).toBe("pending_orders");
  });
  it("create GST invoice opens billing", () => {
    expect(firstTool("GST invoice bana do")).toBe("open_page");
  });
  it("convert cash memo to GST", () => {
    expect(firstTool("Is bill ko cash memo se GST invoice me convert karo")).toBe("convert_invoice");
  });
  it("set an explicit retail price", () => {
    const p = interpret("BD1004 ka retail price 1500 kar do");
    expect(p.steps[0].tool).toBe("set_price");
    expect(p.steps[0].args).toMatchObject({ sku: "BD1004", price: 1500, tier: "retail" });
  });
  it("set an explicit wholesale price", () => {
    const p = interpret("set wholesale price 800 for BD1010");
    expect(p.steps[0].tool).toBe("set_price");
    expect(p.steps[0].args).toMatchObject({ sku: "BD1010", tier: "wholesale" });
  });
  it("record damaged stock", () => {
    const p = interpret("BD1004 ka 2 piece damage ho gaya");
    expect(p.steps[0].tool).toBe("record_damage");
    expect(p.steps[0].args).toMatchObject({ sku: "BD1004", qty: 2 });
  });
  it("navigation", () => {
    expect(firstTool("open inventory")).toBe("open_page");
    expect(firstTool("billing kholo")).toBe("open_page");
  });
});

describe("multi-turn create product (conversational memory)", () => {
  it("collects name → category → price → qty, then creates", () => {
    // Turn 1: starts the flow, asks for the name (no subject yet)
    let p = interpret("New product create karo");
    expect(p.ask?.slot).toBe("name");

    // Turn 2: name → asks category
    p = interpret("Oxidised Choker", p.context);
    expect(p.ask?.slot).toBe("category");

    // Turn 3: category → asks price
    p = interpret("Necklaces", p.context);
    expect(p.ask?.slot).toBe("price");

    // Turn 4: price → asks qty
    p = interpret("800", p.context);
    expect(p.ask?.slot).toBe("qty");

    // Turn 5: qty → ready to create
    p = interpret("20 pieces", p.context);
    expect(p.steps[0]?.tool).toBe("create_product");
    expect(p.steps[0].args).toMatchObject({ category: "Necklaces", price: 800, qty: 20 });
    expect(String(p.steps[0].args.name).toLowerCase()).toContain("choker");
  });

  it("can be cancelled mid-flow", () => {
    let p = interpret("create a new necklace");
    p = interpret("cancel", p.context);
    expect(p.steps.length).toBe(0);
    expect(p.context.pending).toBeUndefined();
  });
});

describe("stock slot-filling", () => {
  it("asks for quantity when only a SKU is given", () => {
    const p = interpret("BD1010 me stock add karo");
    expect(p.ask?.slot).toBe("qty");
    const p2 = interpret("30", p.context);
    expect(p2.steps[0].tool).toBe("add_stock");
    expect(p2.steps[0].args).toMatchObject({ sku: "BD1010", qty: 30 });
  });
});

describe("graceful fallback", () => {
  it("unknown input returns no steps and low confidence", () => {
    const p = interpret("asdfghjkl");
    expect(p.steps.length).toBe(0);
    expect(p.confidence).toBeLessThan(0.45);
  });
});
