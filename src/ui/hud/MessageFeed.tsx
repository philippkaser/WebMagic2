import { useEffect, useState, type CSSProperties } from "react";
import { gameEvents } from "../../core/events";

/** Top-right log of `message` events. Keeps the last five; each line fades
 * via the `wm-msg` animation and is dropped after 5s to match it. */
export function MessageFeed() {
  const [messages, setMessages] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    let nextId = 1;
    return gameEvents.on("message", (text) => {
      const id = nextId++;
      setMessages((prev) => [...prev.slice(-4), { id, text }]);
      setTimeout(() => setMessages((prev) => prev.filter((m) => m.id !== id)), 5000);
    });
  }, []);
  return (
    <div style={feedStyle}>
      {messages.map((m) => (
        <div key={m.id} className="wm-msg">
          {m.text}
        </div>
      ))}
    </div>
  );
}

const feedStyle: CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  textAlign: "right",
  fontSize: 13,
  letterSpacing: 0.5,
};
