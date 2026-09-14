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

  // 1. Primary: OpenAI REST API with Vision support
  const openAiKey = process.env.OPENAI_API_KEY;
  if (openAiKey) {
    try {
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

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
          ],
          temperature: 0.7,
          response_format: { type: "json_object" }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          if (parsed.title) {
            return {
              title: parsed.title,
              suggestions: parsed.suggestions || [parsed.title]
            };
          }
        }
      } else {
        const errText = await response.text();
        console.error("[TitleGen] OpenAI API returned error status:", response.status, errText);
      }
    } catch (err) {
      console.error("[TitleGen] OpenAI generation failed:", err);
    }
  }

  // 2. Secondary Fallback: Gemini REST API
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const prompt = `You are a jewellery expert. Generate an elegant title and 3 alternatives for SKU: ${sku}, Category: ${category}, Polish: ${polish || "Gold/Silver"}. Return JSON {"title": "...", "suggestions": ["...", "..."]}`;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed.title) {
            return { title: parsed.title, suggestions: parsed.suggestions || [parsed.title] };
          }
        }
      }
    } catch (err) {
      console.error("[TitleGen] Gemini fallback failed:", err);
    }
  }

  // 3. Fallback when offline or missing keys
  const fallbackTitle = `${polish ? polish + " " : ""}${category} (${sku})`;
  return {
    title: fallbackTitle,
    suggestions: [fallbackTitle]
  };
}
