import { useState } from "react";
import { useGameEvent } from "../hooks";

type Tone = "plain" | "omen" | "good" | "ally";

/** Messages come from everywhere as plain strings; colour them by what they
 * mean so omens and triumphs read at a glance. */
function toneOf(text: string): Tone {
  if (/not alone|something else|presence|slain|struck down|fallen|broken/i.test(text)) return "omen";
  if (/pact/i.test(text)) return "ally";
  if (/escaped|homeward|endured|equipped|treasure/i.test(text)) return "good";
  return "plain";
}

const LIFETIME_MS = 5200;
let nextId = 1;

/** Top-right: the last few messages, each fading on its own clock. */
export function MessageFeed() {
  const [messages, setMessages] = useState<{ id: number; text: string; tone: Tone }[]>([]);
  useGameEvent("message", (text) => {
    const id = nextId++;
    setMessages((prev) => [...prev.slice(-4), { id, text, tone: toneOf(text) }]);
    setTimeout(() => setMessages((prev) => prev.filter((m) => m.id !== id)), LIFETIME_MS);
  });
  return (
    <div className="wm-hud-tr">
      {messages.map((m) => (
        <div key={m.id} className={`wm-msg${m.tone === "plain" ? "" : ` wm-msg--${m.tone}`}`}>
          {m.text}
        </div>
      ))}
    </div>
  );
}
