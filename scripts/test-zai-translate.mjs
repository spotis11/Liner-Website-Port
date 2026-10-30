import ZAI from 'z-ai-web-dev-sdk';
const zai = await ZAI.create();
const t0 = Date.now();
const completion = await zai.chat.completions.create({
  messages: [
    { role: 'assistant', content: 'You are a song lyric translator. You receive a JSON array of lyric lines. Translate every line into Spanish. Keep the SAME number of items and order. Respond with ONLY a raw JSON array of strings.' },
    { role: 'user', content: 'Target language: Spanish (es).\nLines:\n["I love this song","Turn it up loud","We were young and free"]' },
  ],
  thinking: { type: 'disabled' },
});
console.log('ms:', Date.now() - t0);
console.log('content:', completion.choices[0]?.message?.content);
