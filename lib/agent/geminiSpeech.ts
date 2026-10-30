/** Gemini TTS returns raw 24 kHz, mono PCM; browsers need a WAV container. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function generateGeminiSpeech(text: string) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is missing.');
  const model = process.env.GEMINI_TTS_MODEL?.trim() || 'gemini-3.1-flash-tts-preview';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Read this aloud naturally, warmly and conversationally. Speak only the following text:\n${text}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || 'Puck' } } },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(response.status === 429
      ? 'Gemini speech quota reached. Try again later, or use a system voice.'
      : `Gemini speech request failed (HTTP ${response.status}).`);
  }
  const body = await response.json() as { candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[] };
  const audio = body.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData;
  if (!audio) throw new Error('Gemini returned no speech audio.');
  const bytes = Buffer.from(audio.data, 'base64');
  const wav = audio.mimeType.includes('wav') ? bytes : pcmToWav(bytes, Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] || 24000));
  return { audioBase64: wav.toString('base64'), mimeType: 'audio/wav', alignment: null };
}
