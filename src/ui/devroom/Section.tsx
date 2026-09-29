import type { CSSProperties, ReactNode } from "react";

/** A labeled block of the dev room. */
export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={sectionStyle}>
      <div style={sectionLabelStyle}>{label}</div>
      {children}
    </div>
  );
}

const sectionStyle: CSSProperties = { marginBottom: 14 };
const sectionLabelStyle: CSSProperties = { fontSize: 11, letterSpacing: 2, color: "#6d8a76", marginBottom: 6 };
