/**
 * Service Description Generator using Google Gemini AI.
 *
 * Designed with strict anti-hallucination rules:
 * - NO Refill / Guarantee unless explicitly specified in the service name or notes.
 * - NO Instant / Instant Start unless explicitly stated in the service name or notes.
 * - NO fabricated speeds or start times.
 * - Output is strictly faithful to the provided service title and specifications.
 */

export interface ServiceGenerationInput {
  service_name: string;
  category_name?: string;
  min?: number;
  max?: number;
  idea?: string;
  context_reference?: string;
}

export type RefillStatus = "NO_REFILL" | "HAS_REFILL" | "NONE";

export interface ExtractedServiceAttributes {
  normalizedTitle: string;
  refillStatus: RefillStatus;
  refillDetail?: string;
  hasInstant: boolean;
  instantDetail?: string;
  speed?: string;
}

/**
 * Normalizes Unicode mathematical symbols (e.g. 𝐑𝐞𝐟𝐢𝐥𝐥, 𝟯𝟎, 𝐈𝐍𝐒𝐓𝐀𝐍𝐓, ⚡)
 * into standard ASCII Latin text for reliable parsing and prompt understanding.
 */
export function normalizeTitle(text: string): string {
  if (!text) return "";
  return text.normalize("NFKC").trim();
}

/**
 * Extracts verifiable service attributes from the title and custom notes.
 */
export function extractServiceAttributes(
  rawTitle: string,
  idea?: string
): ExtractedServiceAttributes {
  const normTitle = normalizeTitle(rawTitle);
  const lowerTitle = normTitle.toLowerCase();
  const lowerIdea = (idea || "").toLowerCase();
  const combined = `${lowerTitle} ${lowerIdea}`;

  // 1. Refill / Guarantee Detection
  let refillStatus: RefillStatus = "NONE";
  let refillDetail: string | undefined = undefined;

  // Check explicit negation first (e.g. "No Refill", "Without Refill")
  if (
    /\bno\s*[-_]?\s*refill\b/i.test(combined) ||
    /\bwithout\s*refill\b/i.test(combined) ||
    /\bnon\s*[-_]?\s*refill\b/i.test(combined) ||
    /\bno\s*warranty\b/i.test(combined) ||
    /\bno\s*guarantee\b/i.test(combined)
  ) {
    refillStatus = "NO_REFILL";
    refillDetail = "No Refill / No Warranty";
  } else {
    // Check for explicit refill indicators in title or notes
    const rDaysMatch =
      normTitle.match(/\b(?:R|AR)\s*(\d+)\s*D?\b/i) ||
      normTitle.match(/\b(\d+)\s*days?\s*refill\b/i) ||
      normTitle.match(/\brefill\s*(\d+)\s*days?\b/i) ||
      normTitle.match(/\b(\d+)\s*days?\s*♻️/i) ||
      normTitle.match(/♻️\s*(?:R|AR)?\s*(\d+)\s*D?\b/i) ||
      normTitle.match(/\b(\d+)\s*days?\s*(?:warranty|guarantee)\b/i);

    const lifetimeMatch =
      normTitle.match(/\blifetime\s*(?:refill|♻️)\b/i) ||
      normTitle.match(/♻️\s*lifetime\b/i) ||
      normTitle.match(/\blifetime\s*guarantee\b/i);

    if (rDaysMatch) {
      refillStatus = "HAS_REFILL";
      refillDetail = `${rDaysMatch[1]} Days Refill`;
    } else if (lifetimeMatch) {
      refillStatus = "HAS_REFILL";
      refillDetail = "Lifetime Refill Guarantee";
    } else if (/\bauto\s*refill\b/i.test(combined) || /\bautorefill\b/i.test(combined)) {
      refillStatus = "HAS_REFILL";
      refillDetail = "Auto Refill";
    } else if (/\brefill\s*(?:button|enable|enabled)\b/i.test(combined)) {
      refillStatus = "HAS_REFILL";
      refillDetail = "Refill Button Enabled";
    } else if (lowerTitle.includes("refill") || lowerTitle.includes("♻️")) {
      refillStatus = "HAS_REFILL";
      refillDetail = "Refill Supported";
    } else if (lowerIdea.includes("refill") || lowerIdea.includes("garansi")) {
      // Specified in creator notes
      refillStatus = "HAS_REFILL";
      refillDetail = idea?.trim();
    }
  }

  // 2. Instant / Start Time Detection
  let hasInstant = false;
  let instantDetail: string | undefined = undefined;

  if (
    /\binstant\b/i.test(lowerTitle) ||
    /\binstan\b/i.test(lowerTitle) ||
    /\binstant\b/i.test(lowerIdea) ||
    /\binstan\b/i.test(lowerIdea)
  ) {
    hasInstant = true;
    const windowMatch = normTitle.match(
      /\binstant(?:\s*start)?(?:\s*[-–]\s*\d+\s*(?:hours?|hrs?|mins?|minutes?))?\b/i
    );
    if (windowMatch) {
      instantDetail = windowMatch[0].trim();
    } else {
      instantDetail = "Instant Start";
    }
  }

  // 3. Delivery Speed Detection
  let speed: string | undefined = undefined;
  const m1 = normTitle.match(
    /(?:⚡\s*)?(?:speed\s*[:\s]*)?([0-9.,]+[kKmMbB]?\+?(?:\s*[-–]\s*[0-9.,]+[kKmMbB]?\+?)?\s*\/\s*(?:day|days|d|sec|second|seconds|hour|hr|hrs|h|daily))\b/i
  );
  const m2 = normTitle.match(/\bday\s*([0-9.,]+[kKmMbB]?\+?)\b/i);
  const m3 = normTitle.match(/\b([0-9.,]+[kKmMbB]?\+?)\s*\/\s*day\b/i);
  const m4 = normTitle.match(/\b([0-9.,]+(?:\s*[-–]\s*[0-9.,]+)?\s*[kKmMbB]?\+?\s*daily)\b/i);

  if (m1) speed = m1[1].trim();
  else if (m2) speed = `${m2[1].trim()}/Day`;
  else if (m3) speed = `${m3[1].trim()}/Day`;
  else if (m4) speed = m4[1].trim();

  return {
    normalizedTitle: normTitle,
    refillStatus,
    refillDetail,
    hasInstant,
    instantDetail,
    speed,
  };
}

/**
 * Builds a strict, anti-hallucination prompt for Gemini AI.
 */
export function buildStrictPrompt(
  input: ServiceGenerationInput,
  attrs: ExtractedServiceAttributes
): string {
  const { normalizedTitle, refillStatus, refillDetail, hasInstant, instantDetail, speed } = attrs;
  const catName = input.category_name || "General";

  // Context reference handling: replace {title}, {TITLE}, {judul} with clean title
  let contextSnippet = "";
  if (input.context_reference && input.context_reference.trim()) {
    const processedContext = input.context_reference
      .replace(/\{title\}|\{TITLE\}|\{judul\}|\{JUDUL\}/gi, normalizedTitle)
      .trim();
    if (processedContext) {
      contextSnippet = `\n- Reference Context Data:\n"""\n${processedContext}\n"""\n`;
    }
  }

  // Refill instruction
  let refillRule = "";
  if (refillStatus === "NO_REFILL") {
    refillRule = `REFILL & WARRANTY RULE (CRITICAL):
- The service title explicitly specifies "NO REFILL".
- You MUST state that this service is provided with "No Refill / No Warranty".
- You are 100% STRICTLY FORBIDDEN from stating or promising any refill guarantee period (NEVER mention 30 days refill, guarantee, replenishment, etc.).`;
  } else if (refillStatus === "HAS_REFILL") {
    refillRule = `REFILL & WARRANTY RULE:
- The title or notes specify: "${refillDetail}".
- Include this exact refill/warranty specification in the features.
- Do NOT exaggerate or invent longer guarantee periods beyond what is stated.`;
  } else {
    refillRule = `REFILL & WARRANTY RULE (CRITICAL):
- The service title DOES NOT mention refill, warranty, or guarantee.
- You are 100% STRICTLY FORBIDDEN from mentioning "refill", "warranty", "guarantee", or "drop protection" anywhere in the description. Do NOT add a Refill bullet point or claim any refill guarantee.`;
  }

  // Instant instruction
  let instantRule = "";
  if (hasInstant) {
    instantRule = `INSTANT / START TIME RULE:
- The title specifies instant start: "${instantDetail || "Instant"}".
- Include this start time parameter as stated.`;
  } else {
    instantRule = `INSTANT / START TIME RULE (CRITICAL):
- The service title DOES NOT mention Instant or Instan.
- You are 100% STRICTLY FORBIDDEN from using the word "instant", "instantly", or "immediate".
- Do NOT fabricate start times (e.g. do NOT say "instant start", "starts within minutes", "starts 0-1 hour").
- Do NOT use "instant" in marketing phrases (e.g. do NOT say "instant boost", "instant results", "instant social proof").`;
  }

  // Speed instruction
  let speedRule = "";
  if (speed) {
    speedRule = `- Speed: State the delivery speed exactly as provided: "${speed}".`;
  } else {
    speedRule = `- Speed: Do NOT fabricate, guess, or invent delivery speeds if not in the title.`;
  }

  return `You are a professional, accurate copywriter for an SMM (Social Media Marketing) reseller panel.
Your task is to write a clean, factual, concise, and professional service description in ENGLISH for the following service:

- Service Title: "${normalizedTitle}"
- Service Category: "${catName}"
${input.min ? `- Minimum Order: ${input.min}` : ""}
${input.max ? `- Maximum Order: ${input.max}` : ""}
${input.idea && input.idea.trim() ? `- Creator Notes: "${input.idea.trim()}"` : ""}
${contextSnippet}

CRITICAL ACCURACY & STRICT ANTI-HALLUCINATION RULES:
1. ZERO FABRICATION / DATA FIDELITY:
   - Output ONLY facts and features explicitly provided in the Service Title, Category, Min/Max, or Notes above.
   - If a specification is NOT in the provided data, OMIT IT entirely. Never guess, assume, or fill in default SMM claims.
   - The Service Title takes strict precedence over any general reference context. If the reference context mentions refill or instant but the Service Title does not, DO NOT include them for this service.

2. ${refillRule}

3. ${instantRule}

4. ${speedRule}

5. NO MARKETING HYPERBOLE:
   - Do NOT use exaggerated claims like "guaranteed viral growth", "instant boost", "instant social proof", "lightning fast delivery", or "guaranteed non-drop" unless explicitly stated in the title.

6. FORMAT & STYLE REQUIREMENTS:
   - Write exclusively in ENGLISH.
   - STRICT PROHIBITION: Do NOT use markdown bold asterisks (NEVER use '**' or '*'). Do NOT use bold syntax anywhere in the text. Use clean plain text headers and bullet points with '-' instead.
   - Output structure:
     Brief 1-2 sentence service overview
     Service Specifications (bullet points with '-' containing only verified details)
     Important Instructions (link format requirements, account public visibility, avoiding duplicate simultaneous orders)
   - Provide ONLY the final service description text directly. Do not wrap in markdown code blocks, and do not include greetings or quotes.`;
}

/**
 * Helper to call Google Gemini API with low temperature for factual precision.
 */
export async function callGemini(
  apiKey: string,
  prompt: string,
  temperature: number = 0.2
): Promise<string> {
  const models = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemini-pro-latest",
  ];

  let lastError = "";
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens: 1024,
          },
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        lastError = json?.error?.message || `HTTP ${response.status} (${model})`;
        continue;
      }

      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && typeof text === "string" && text.trim()) {
        return text.trim();
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`Gagal memanggil Gemini API: ${lastError}`);
}

/**
 * Post-processes and sanitizes the description to enforce zero-hallucination.
 * Guaranteed to strip out any hallucinated refill or instant claims.
 */
export function sanitizeDescription(
  raw: string,
  attrs: ExtractedServiceAttributes
): string {
  let text = raw
    .replace(/\*\*/g, "")
    .replace(/\*/g, "-")
    .replace(/^["']|["']$/g, "")
    .trim();

  // 1. Post-filter: If NO REFILL was in the title/notes, strip any hallucinated refill line
  if (attrs.refillStatus === "NONE") {
    const lines = text.split("\n");
    const filtered = lines.filter((line) => {
      const lower = line.toLowerCase().trim();
      // If line is a bullet point or heading about refill/warranty/guarantee
      if (
        lower.startsWith("- refill") ||
        lower.startsWith("- warranty") ||
        lower.startsWith("- guarantee") ||
        lower.startsWith("refill:") ||
        lower.startsWith("warranty:") ||
        lower.startsWith("guarantee:") ||
        /\b(?:30|60|365|\d+)\s*days?\s*(?:refill|warranty|guarantee)\b/i.test(line) ||
        /\brefill\s*guarantee\b/i.test(line)
      ) {
        return false;
      }
      return true;
    });
    text = filtered.join("\n");

    // Clean any lingering refill sentence in prose
    text = text.replace(/[^.!?\n]*\b(?:refill|warranty\s*guarantee)\b[^.!?\n]*[.!?]/gi, "");
  } else if (attrs.refillStatus === "NO_REFILL") {
    // If the service explicitly has No Refill, strip any contradictory positive guarantee
    const lines = text.split("\n");
    const filtered = lines.filter((line) => {
      const lower = line.toLowerCase();
      if (
        /\b\d+\s*days?\b/i.test(line) &&
        (lower.includes("refill") || lower.includes("guarantee") || lower.includes("warranty"))
      ) {
        return false;
      }
      return true;
    });
    text = filtered.join("\n");
  }

  // 2. Post-filter: If Instant was NOT in the title/notes, remove instant lines & buzzwords
  if (!attrs.hasInstant) {
    const lines = text.split("\n");
    const filtered = lines.filter((line) => {
      const lower = line.toLowerCase().trim();
      if (
        lower.startsWith("- start time: instant") ||
        lower.startsWith("- instant start") ||
        lower === "- speed: instant" ||
        lower.startsWith("- start: instant")
      ) {
        return false;
      }
      return true;
    });
    text = filtered.join("\n");

    // Replace marketing buzzwords like "instantly" or "instant social proof"
    text = text
      .replace(/\binstantly\b/gi, "reliably")
      .replace(/\binstant\s+social\s+proof\b/gi, "social proof")
      .replace(/\binstant\s+boost\b/gi, "boost")
      .replace(/\binstant\s+results\b/gi, "effective results")
      .replace(/\binstant\s+delivery\b/gi, "fast delivery")
      .replace(/\binstant\s+start\b/gi, "fast start");
  }

  // Clean excessive blank lines
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

/**
 * Main function to generate a truthful, high-fidelity service description.
 */
export async function generateServiceDescription(
  apiKey: string,
  input: ServiceGenerationInput
): Promise<string> {
  const attrs = extractServiceAttributes(input.service_name, input.idea);
  const prompt = buildStrictPrompt(input, attrs);
  const rawText = await callGemini(apiKey, prompt, 0.2);
  const cleaned = sanitizeDescription(rawText, attrs);
  return cleaned;
}
