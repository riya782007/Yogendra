import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

interface TitleGenParams {
  category: string;
  subcategory?: string;
  sku: string;
  color?: string;
  polish?: string;
  imageUrl?: string;
  existingName?: string;
}

export async function generateProductTitle(params: TitleGenParams): Promise<{ title: string; suggestions: string[] }> {
  const { category, subcategory, sku, color, polish, imageUrl, existingName } = params;

  // 1. Primary: OpenAI API with Vision support
  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const systemPrompt = `You are an expert luxury Indian jewellery copywriter for Yogendra Industries.
Generate high-converting, elegant product titles following these strict rules:
1. Include an authentic, modern girl name anchor for the design (e.g., 'Kashvi', 'Aadhya', 'Ananya').
2. Accurately describe the jewellery type, stones, polish, and style (e.g., 'Handcrafted Kundan & Pearl Choker Set').
3. Keep the title concise (5–9 words), punchy, and SEO-optimised.
4. Output STRICT JSON format: {"title": "Primary Title", "suggestions": ["Title 2", "Title 3", "Title 4"]}.
5. Do not include markdown code blocks or extra text.`;

      const userContent: any[] = [
        {
          type: "text",
          text: `SKU: ${sku}\nCategory: ${category}\nSubcategory: ${subcategory || "N/A"}\nColor/Finish: ${color || "N/A"}\nPolish: ${polish || "N/A"}\nCurrent Name: ${existingName || "N/A"}`
        }
      ];

      if (imageUrl && imageUrl.startsWith("http")) {
        userContent.push({
          type: "image_url",
          image_url: { url: imageUrl }
        });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices[0].message.content || "{}");
      if (parsed.title) {
        return {
          title: parsed.title,
          suggestions: parsed.suggestions || [parsed.title]
        };
      }
    } catch (err) {
      console.error("[TitleGen] OpenAI generation failed, attempting Gemini fallback:", err);
    }
  }

  // 2. Secondary Fallback: Gemini API
  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Generate a luxury jewellery title for SKU: ${sku}, Category: ${category}, Polish: ${polish || "Gold/Silver"}. Return JSON {"title": "Title", "suggestions": ["Alt 1", "Alt 2"]}`;
      const res = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: prompt
      });
      const parsed = JSON.parse(res.text || "{}");
      if (parsed.title) {
        return { title: parsed.title, suggestions: parsed.suggestions || [parsed.title] };
      }
    } catch (err) {
      console.error("[TitleGen] Gemini fallback failed:", err);
    }
  }

  // 3. Fallback when keys are missing or offline
  const fallbackTitle = `${polish ? polish + " " : ""}${category} (${sku})`;
  return {
    title: fallbackTitle,
    suggestions: [fallbackTitle]
  };
}
