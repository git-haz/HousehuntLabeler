import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a property type classifier. Analyze the provided property photo(s) and determine:

1. Whether the building is a DETACHED house or bungalow (no shared walls, at least 10ft gap to nearest building)
2. Whether it is a BUNGALOW (single storey, detached)
3. Or something else (semi-detached, terraced, end-terrace, flat, apartment block, etc.)

For each image, respond in this exact JSON format:
{
  "images": [
    {
      "image_number": 1,
      "classification": "detached|bungalow|semi-detached|terraced|end-terrace|flat|apartment-block|unknown",
      "confidence": 0-100,
      "reasoning": "Brief visual reasoning: shared walls, roofline continuity, gaps, fences, driveways, symmetry, etc."
    }
  ],
  "overall_classification": "detached|bungalow|semi-detached|terraced|end-terrace|flat|apartment-block|unknown",
  "overall_confidence": 0-100,
  "label": "detached|reject-housetype|review"
}

Rules:
- "detached" label only if confidence > 95 AND classification is detached or bungalow
- "reject-housetype" if the building is clearly not detached
- "review" if images are unclear, obstructed, or too zoomed-in
- A bungalow must be clearly single-storey
- Distance to neighbouring building must appear to be at least 10 feet for detached
- Respond ONLY with the JSON, no other text`;

export async function analyzeImagesWithVision(apiKey, imageBuffers) {
  const client = new Anthropic({ apiKey });

  const content = [];
  for (let i = 0; i < imageBuffers.length; i++) {
    const { buffer, mimeType } = imageBuffers[i];
    const base64 = buffer.toString('base64');
    const mediaType = mimeType || 'image/jpeg';
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    });
    content.push({
      type: 'text',
      text: `Image ${i + 1} above.`,
    });
  }

  content.push({
    type: 'text',
    text: 'Analyze all the property images above and classify the building type.',
  });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { error: 'No JSON in response', raw: text };
  }

  try {
    const result = JSON.parse(jsonMatch[0]);
    result.usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    return result;
  } catch {
    return { error: 'Failed to parse JSON', raw: text };
  }
}
