import { useEffect, useMemo, useRef, useState } from "react";
import { sanitizeUsernameDraft, PASSWORD_MAX } from "../../../net/credentials";
import { useNet } from "../../../net/netStore";
import {
  claimWizard,
  createAccount,
  hideLedgerForm,
  retryLedger,
  showLedgerForm,
  signIn,
  signOut,
  useAccount,
} from "../../../state/account";
import type { FontId } from "../../font/faces";
import { UiPresence } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { RuneField, type RuneFieldHandle } from "../../RuneField";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { measureText, RuneText } from "../../text/RuneText";
import { STEP, typePx } from "../../text/type";
import { ink } from "../../theme";
import { colsFor, Flourish, PixelIcon, spaced } from "./grimoire";
import {
  GUEST_LEFT_BEHIND,
  ledgerErrorText,
  ledgerForm,
  ledgerLine,
  OFFER_LABEL,
  type LedgerMode,
  type LedgerOffer,
} from "./ledgerText";
import { MENU_INK } from "./menuText";
import { Delayed } from "./stage";

/** The Wizard's Ledger — the title screen's sign-in, built from the same
 * stone and runes as everything else:
 *
 *   - `LedgerLine`: one line under the controls saying who you are to the
 *     ledger (a guest, a member, offline) beside small slate buttons for
 *     what you may do — sign in, create an account, claim this wizard,
 *     sign out, or knock on a silent server again.
 *   - `LedgerTablet`: the form, a tablet that builds where the laws stood —
 *     a username slab, a password slab whose letters burn in as ✦ and settle
 *     into •, refusals written in blood, the way forward in arcane.
 *
 * Both sit on the title's stage (MainMenu.tsx), in screen-height units. */

/** RuneText px for step `n` of the type scale at the title's distance. */
const D = 1.6;
const tp = (n: number, face?: FontId) => typePx(D, n, face);

export function LedgerLine({ U, y }: { U: number; y: number }) {
  const status = useAccount((s) => s.status);
  const username = useAccount((s) => s.username);
  const lapsed = useAccount((s) => s.lapsed);
  const pending = useAccount((s) => s.pending);
  const mode = useNet((s) => s.mode);
  const line = ledgerLine({ status, username, mode, lapsed });
  const px = tp(STEP.text);
  const labelPx = tp(STEP.text, "label");

  const act = (offer: LedgerOffer) => {
    if (offer === "signOut") signOut();
    else if (offer === "retry") void retryLedger();
    else showLedgerForm(offer);
  };

  // One centred row: the words, then a slate button per offer. The words
  // hang from their right end, so when RuneText snaps them to whole screen
  // pixels (smaller, below 800 px) they stay beside their buttons.
  const layout = useMemo(() => {
    const gap = 0.018 * U;
    const textW = measureText(line.text, labelPx, undefined, "label").width;
    const buttons = line.offers.map((o) => measureText(OFFER_LABEL[o], px).width + px * 16);
    const total = textW + buttons.reduce((s, w) => s + w + gap, 0);
    let x = -total / 2 + textW;
    const textEnd = x;
    const at = buttons.map((w) => {
      const cx = x + gap + w / 2;
      x += gap + w;
      return cx;
    });
    return { textEnd, at, buttons };
  }, [line, labelPx, px, U]);

  return (
    <group position={[0, y, 0]}>
      <RuneText text={line.text} font="label" px={labelPx} anchor={[1, 0.5]} position={[layout.textEnd, 0, 0]} glow={0.25} />
      {line.offers.map((o, i) => (
        <RuneButton
          key={o}
          label={OFFER_LABEL[o]}
          variant="ghost"
          onPress={() => act(o)}
          disabled={pending !== null}
          px={px}
          width={layout.buttons[i]}
          color={o === "claim" ? ink.brassLight : ink.parchmentDim}
          position={[layout.at[i]!, 0, 0]}
          delay={0.1 + i * 0.05}
        />
      ))}
    </group>
  );
}

/** The form standing open (the account store's `form`); closing it breaks
 * the tablet apart and the title returns. */
export function LedgerTablet({ U }: { U: number }) {
  const mode = useAccount((s) => s.form);
  // Keep the last form's words while the tablet breaks apart.
  const last = useRef<LedgerMode>("signIn");
  if (mode) last.current = mode;
  return (
    <UiPresence show={mode !== null} exit={TABLET_EXIT}>
      <Delayed by={0.35}>
        <LedgerForm U={U} mode={last.current} open={mode !== null} />
      </Delayed>
    </UiPresence>
  );
}

const W = 0.5;
const H = 0.44;
const CENTER_Y = -0.115;
/** The fields' slate, a shade warmer than the tablet so they read as slots. */
const FIELD_IDLE = "#6a5f78";

function LedgerForm({ U, mode, open }: { U: number; mode: LedgerMode; open: boolean }) {
  const status = useAccount((s) => s.status);
  const pending = useAccount((s) => s.pending);
  const error = useAccount((s) => s.error);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const userField = useRef<RuneFieldHandle | null>(null);
  const passField = useRef<RuneFieldHandle | null>(null);
  const copy = ledgerForm(mode);
  const px = tp(STEP.text);
  const labelPx = tp(STEP.text, "label");
  const fieldW = 0.3 * U;

  const submit = () => {
    if (pending) return;
    if (mode === "signIn") signIn(username, password);
    else if (mode === "register") createAccount(username, password);
    else claimWizard(username, password);
  };

  // Opening (or switching forms) starts clean, the username slab ready to
  // write (autoFocus); closing forgets the secret.
  useEffect(() => {
    setPassword("");
  }, [open, mode]);

  // Escape closes the ledger (a field being written takes its own Escape).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideLedgerForm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const errorText = error ? ledgerErrorText(error.reason, error.retryAfterMs) : null;
  const warn = status === "guest" && mode !== "claim" ? GUEST_LEFT_BEHIND : null;
  const note = errorText ?? warn ?? copy.hint;
  const noteColor = errorText ? MENU_INK.blood : warn ? MENU_INK.wound : MENU_INK.dim;
  const bad = error?.reason;
  const top = (H / 2) * U;
  const iconPx = 0.0026 * U;

  return (
    <group position={[0, CENTER_Y * U, 0]}>
      <Tablet width={W * U} height={H * U} tile={0.13} thickness={0.04} frame="iron" tint="#231d29" tilt seed={37}>
        <PixelIcon name="gem" tint={ink.arcane} pixel={iconPx} position={[0, top - 0.035 * U, 0.002]} delay={0.05} />
        <RuneText
          text={copy.title}
          font="heading"
          px={tp(1, "heading")}
          color={ink.parchment}
          glow={0.35}
          position={[0, top - 0.072 * U, 0]}
          delay={0.1}
        />
        <Flourish width={0.22 * U} texel={iconPx * 0.6} position={[0, top - 0.098 * U, 0.002]} delay={0.2} />
        <RuneText
          text={copy.lore}
          px={px}
          maxCols={colsFor(0.42 * U, px)}
          color={ink.parchmentDim}
          glow={0.2}
          position={[0, top - 0.135 * U, 0]}
          delay={0.25}
          stagger={0.6}
        />
        <RuneText text={spaced("Username")} font="label" px={labelPx} color={ink.faded} position={[0, top - 0.185 * U, 0]} delay={0.3} />
        <RuneField
          handle={userField}
          value={username}
          onInput={setUsername}
          onEnter={() => passField.current?.focus()}
          onTab={() => passField.current?.focus()}
          sanitize={sanitizeUsernameDraft}
          maxLength={16}
          px={px}
          width={fieldW}
          position={[0, top - 0.217 * U, 0]}
          invalid={bad === "bad-username" || bad === "username-taken" || bad === "bad-credentials"}
          disabled={pending !== null}
          label="Username"
          autoComplete="username"
          autoFocus={open ? mode : false}
          idleFrame={FIELD_IDLE}
        />
        <RuneText text={spaced("Password")} font="label" px={labelPx} color={ink.faded} position={[0, top - 0.255 * U, 0]} delay={0.35} />
        <RuneField
          handle={passField}
          value={password}
          onInput={setPassword}
          onEnter={submit}
          onTab={() => userField.current?.focus()}
          password
          maxLength={PASSWORD_MAX}
          px={px}
          width={fieldW}
          position={[0, top - 0.287 * U, 0]}
          invalid={bad === "bad-password" || bad === "bad-credentials"}
          disabled={pending !== null}
          idleFrame={FIELD_IDLE}
          label="Password"
          autoComplete={mode === "signIn" ? "current-password" : "new-password"}
        />
        {note && (
          <RuneText
            text={note}
            px={px}
            maxCols={colsFor(0.47 * U, px)}
            color={noteColor}
            glow={errorText ? 0.6 : 0.2}
            position={[0, top - 0.325 * U, 0]}
          />
        )}
        <RuneButton
          label="Back"
          variant="ghost"
          onPress={hideLedgerForm}
          px={px}
          width={0.1 * U}
          color={ink.parchmentDim}
          position={[-0.165 * U, top - 0.38 * U, 0]}
          delay={0.4}
        />
        <RuneButton
          label={pending && pending !== "signOut" ? "Writing…" : copy.submit}
          onPress={submit}
          disabled={pending !== null}
          px={px}
          position={[copy.alternative ? -0.015 * U : 0, top - 0.38 * U, 0]}
          delay={0.45}
        />
        {copy.alternative && (
          <RuneButton
            label={copy.alternative.label}
            variant="ghost"
            onPress={() => showLedgerForm(copy.alternative!.mode)}
            disabled={pending !== null}
            px={px}
            width={0.12 * U}
            color={ink.parchmentDim}
            position={[0.16 * U, top - 0.38 * U, 0]}
            delay={0.5}
          />
        )}
      </Tablet>
    </group>
  );
}
