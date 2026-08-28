"use client";

/**
 * Apex's voice, written the way the story section reads: short phrases in
 * large type, the one being said right now lit, the ones just said fading
 * above it. The reveal is driven by how far the speech has actually got, so
 * the words land with the voice instead of arriving all at once.
 */

const ACCENT = "#00e5ff";
const CREAM = "#ffeccc";

/** Breaks a reply into speakable phrases — clause boundaries first, then long runs. */
export function toPhrases(text: string, maxWords = 5): string[] {
  const clauses = text
    .split(/(?<=[.!?,;:—])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const phrases: string[] = [];
  for (const clause of clauses) {
    const words = clause.split(/\s+/);
    for (let i = 0; i < words.length; i += maxWords) {
      phrases.push(words.slice(i, i + maxWords).join(" "));
    }
  }
  return phrases.length ? phrases : [text];
}

export default function ApexCaptions({
  text,
  spokenChars,
  speaking,
  onStop,
}: {
  text: string;
  spokenChars: number;
  speaking: boolean;
  onStop: () => void;
}) {
  if (!text) return null;

  const phrases = toPhrases(text);

  // Walk the phrases against the raw text so the character budget stays true
  // even where splitting dropped whitespace.
  let cursor = 0;
  const ends = phrases.map((p) => {
    const found = text.indexOf(p, cursor);
    const start = found === -1 ? cursor : found;
    cursor = start + p.length;
    return cursor;
  });

  let activeIndex = ends.findIndex((end) => spokenChars < end);
  if (activeIndex === -1) activeIndex = phrases.length - 1;

  const previous = phrases.slice(Math.max(0, activeIndex - 2), activeIndex);
  const active = phrases[activeIndex];

  return (
    // Upper-left: the widest genuinely empty column on the page. The orb owns
    // the middle and the agent labels start around a third of the way across,
    // so the captions stay narrow and high to keep off both.
    <div
      aria-live="polite"
      style={{
        position: "absolute", left: "clamp(18px, 2.5vw, 34px)", top: 168,
        width: "min(250px, 19vw)", zIndex: 20, pointerEvents: "none",
      }}
    >
      {previous.map((phrase, i) => (
        <div
          key={`${phrase}-${i}`}
          style={{
            fontSize: "clamp(10px, 0.78vw, 12px)",
            lineHeight: 1.4,
            // The older of the two sits further back.
            color: `rgba(240,237,232,${i === previous.length - 1 ? 0.42 : 0.24})`,
            marginBottom: 3,
          }}
        >
          {phrase}
        </div>
      ))}

      <div
        style={{
          fontSize: "clamp(13px, 1.15vw, 17px)",
          lineHeight: 1.3,
          color: CREAM,
          textShadow: `0 0 26px ${CREAM}44, 0 0 60px ${ACCENT}22`,
          marginTop: 5,
        }}
      >
        {active}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap", pointerEvents: "auto" }}>
        <div style={{ display: "flex", gap: 7 }}>
          {phrases.slice(0, 8).map((_, i) => (
            <span
              key={i}
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: i === Math.min(activeIndex, 7) ? "#f5a623" : `${ACCENT}66`,
                boxShadow: i === Math.min(activeIndex, 7) ? "0 0 10px #f5a623" : "none",
                transition: "background .25s",
              }}
            />
          ))}
        </div>

        {speaking && (
          <button
            type="button"
            onClick={onStop}
            style={{
              display: "flex", alignItems: "center", gap: 9,
              background: "rgba(4,8,15,0.6)", border: "1px solid rgba(240,237,232,0.22)",
              borderRadius: 22, padding: "8px 18px", cursor: "pointer",
              fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.24em",
              color: "rgba(240,237,232,0.85)", backdropFilter: "blur(6px)",
            }}
          >
            <span style={{ width: 9, height: 9, background: "rgba(240,237,232,0.85)", borderRadius: 1 }} />
            STOP
          </button>
        )}
      </div>
    </div>
  );
}
