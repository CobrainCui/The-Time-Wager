import OpenAI from "openai";

// If you are using a base URL (e.g., a proxy or alternative model provider), you can set it in .env
// We will use the official OpenAI endpoint if OPENAI_BASE_URL is not provided.
let openai: OpenAI | null = null;

function getClient(): OpenAI {
    if (!openai) {
        if (!process.env.OPENAI_API_KEY) {
            console.warn("⚠️ OPENAI_API_KEY is not set in .env. AI auto-play will not work.");
        }
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || "dummy",
            baseURL: process.env.OPENAI_BASE_URL,
        });
    }
    return openai;
}

export async function askLLM(systemPrompt: string, userPrompt: string): Promise<any> {
    const client = getClient();
    try {
        const response = await client.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error("Empty response from LLM");
        
        return JSON.parse(content);
    } catch (error) {
        console.error("❌ LLM Request Failed:", error);
        return null;
    }
}
