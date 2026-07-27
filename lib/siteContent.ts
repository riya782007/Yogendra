export type Section = { h?: string; p: string };
export type Page = { title: string; intro: string; sections: Section[] };

export const PAGES: Record<string, Page> = {
  about: {
    title: "About Blythe Diva",
    intro: "Where elegance meets empowerment — handcrafted artificial jewellery from the heart of Sadar Bazar, Delhi.",
    sections: [
      { h: "Our story", p: "Blythe Diva, by Yogendra Industries, began in the bustling lanes of Rui Mandi, Sadar Bazar — one of India's largest jewellery wholesale hubs. What started as a family trade has grown into a brand trusted by retailers across the country and loved by thousands of customers." },
      { h: "Our craft", p: "Every piece blends traditional artistry — Kundan, Meenakari, Temple and Polki work — with modern, trend-ready design. We use premium brass alloys with anti-tarnish plating so your jewellery stays beautiful, lightweight, and comfortable for daily and festive wear." },
      { h: "Retail & wholesale", p: "We serve both the customer who wants one perfect piece and the retailer sourcing in bulk. Approved retailers unlock factory-direct trade pricing with minimum order quantities, while every shopper enjoys honest pricing, real reviews, and easy returns." },
    ],
  },
  contact: {
    title: "Contact Us",
    intro: "We're here to help — reach out any time.",
    sections: [
      { h: "WhatsApp & Orders", p: "Message us on WhatsApp at +91 98731 51767 for orders, stock checks, and wholesale enquiries — it's the fastest way to reach us." },
      { h: "Call", p: "Phone: +91 95820 02623, Monday to Saturday, 10:00 AM – 8:00 PM IST." },
      { h: "Visit", p: "Blythe Diva · Yogendra Industries, Sadar Bazar, Rui Mandi, Delhi 110006, India." },
      { h: "Wholesale", p: "Retailers can apply for a trade account from the Wholesale page; the owner approves each account before trade pricing is unlocked." },
    ],
  },
  shipping: {
    title: "Shipping Policy",
    intro: "Fast, tracked delivery across India.",
    sections: [
      { h: "Charges", p: "A flat ₹100 shipping charge applies to every order, anywhere in India. Cash on Delivery is available across serviceable pincodes (a small COD handling fee applies)." },
      { h: "Dispatch & delivery", p: "Orders are dispatched within 1–2 business days. Delivery typically takes 3–7 business days depending on your location. You'll receive tracking details on WhatsApp once your order ships." },
      { h: "Serviceability", p: "We ship pan-India through our logistics partners. If a pincode is not serviceable, our team will contact you with alternatives." },
    ],
  },
  returns: {
    title: "Returns & Cancellation",
    intro: "Shop with confidence — easy 7-day returns.",
    sections: [
      { h: "7-day returns", p: "If you're not happy with your purchase, you can request a return within 7 days of delivery. The item must be unused and in its original condition and packaging." },
      { h: "How to return", p: "Message us on WhatsApp with your order number and reason. We'll arrange a pickup or guide you through the process and process your refund once the item is received and inspected." },
      { h: "Cancellation", p: "Orders can be cancelled before they are dispatched. Once shipped, the return policy applies. Refunds are issued to the original payment method or as store credit for COD orders." },
    ],
  },
  faq: {
    title: "Frequently Asked Questions",
    intro: "Quick answers to common questions.",
    sections: [
      { h: "Is the jewellery real gold?", p: "No — Blythe Diva specialises in premium artificial (imitation) jewellery: brass alloy with anti-tarnish gold/silver plating. It looks luxurious, is lightweight, and is a fraction of the cost of fine jewellery." },
      { h: "Will it tarnish or turn my skin green?", p: "Our anti-tarnish plating resists discolouration with normal care. Keep pieces away from water, perfume, and sweat, and store them dry to keep them looking their best for longer." },
      { h: "Do you offer Cash on Delivery?", p: "Yes, COD is available across serviceable pincodes, alongside online payment options." },
      { h: "Can I order in bulk for my shop?", p: "Absolutely. Apply for a wholesale account on the Wholesale page; once approved by the owner, you'll see factory-direct trade rates and minimum order quantities." },
      { h: "How do I track my order?", p: "You'll receive tracking details on WhatsApp once your order is dispatched." },
    ],
  },
  "size-guide": {
    title: "Size & Length Guide",
    intro: "Find your perfect fit for every piece.",
    sections: [
      { h: "Necklaces", p: "Choker: 30–36 cm, sits at the base of the neck. Princess: 42–48 cm, the most popular everyday length. Matinee: 50–60 cm. Long/Rani Haar: 70 cm+, ideal for bridal and festive looks." },
      { h: "Bracelets & Kada", p: "Standard: 18–19 cm. For a relaxed fit, measure your wrist and add 1.5–2 cm. Many of our kadas and bangle pairs are available in standard 2.4 and 2.6 sizes." },
      { h: "Rings", p: "Several of our rings are adjustable. For fixed sizes, measure the inner diameter of a ring that fits you well and match it to our size chart on the product page." },
      { h: "Anklets (Payal)", p: "Standard: 25–27 cm with an adjustable chain. For a snug fit, measure your ankle and add 2 cm of comfort room." },
    ],
  },
};
