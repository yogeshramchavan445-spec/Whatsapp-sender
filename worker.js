export default {
  async fetch(request, env) {
    // API keys from Cloudflare environment (set in dashboard)
    const apiKeys = [
      env.API_KEY_1,
      env.API_KEY_2,
      env.API_KEY_3,
      env.API_KEY_4,
      env.API_KEY_5
    ].filter(Boolean); // filter empty

    // fallback message if no keys defined
    if (!apiKeys.length) {
      return new Response(JSON.stringify({ reply: "Server setup incomplete: no API keys configured." }), {
        headers: { "Content-Type": "application/json" },
        status: 500
      });
    }

    // Parse incoming JSON safely
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response("Invalid JSON", { status: 400 });
    }
    const userMessage = (body.message || "").toString();

    // rotate index stored in memory per-request (simple round-robin)
    // Note: Cloudflare worker instance memory isn't shared; we do local rotation per request
    // We'll attempt keys sequentially until one works.
    async function askWithKey(key) {
      try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "तुम एक स्मार्ट WhatsApp helper हो। यूज़र के सवाल को समझ कर साफ़, मददगार और छोटा जवाब दो।"
              },
              {
                role: "user",
                content: userMessage
              }
            ],
            max_tokens: 500
          }),
          // set a short timeout by using AbortController if needed (not shown)
        });

        // if rate-limited (429) → return special
        if (resp.status === 429) {
          return { ok: false, reason: "rate_limited" };
        }

        if (!resp.ok) {
          // other HTTP errors => treat as fail for this key
          return { ok: false, reason: `http_${resp.status}` };
        }

        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content ?? null;
        if (!text) return { ok: false, reason: "no_text" };

        return { ok: true, text };
      } catch (err) {
        return { ok: false, reason: "network_error" };
      }
    }

    // Try each key in order; if a key returns a valid reply, use it.
    for (let i = 0; i < apiKeys.length; i++) {
      const key = apiKeys[i];
      const result = await askWithKey(key);
      if (result.ok) {
        return new Response(JSON.stringify({ reply: result.text }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      // If rate_limited or error, continue to next key
    }

    // All failed
    return new Response(JSON.stringify({ reply: "⚠️ सभी API keys का quota/connection समस्या हुई। बाद में कोशिश करें।" }), {
      headers: { "Content-Type": "application/json" },
      status: 503
    });
  }
};
