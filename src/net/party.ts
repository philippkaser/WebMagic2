/** Fellowships — wizards who go down together. Pure logic the relay owns
 * (server-side truth), unit-tested without a socket.
 *
 *  - A party has a leader, up to MAX_PARTY members, and an invite CODE: six
 *    runes from an alphabet with nothing to misread (no 0/O, 1/I/L, 2/Z,
 *    5/S, 8/B). Share the code anywhere; whoever speaks it joins.
 *  - Or invite a wizard standing near you: the invite waits for them a
 *    little while, and accepting it puts them in your party (making one if
 *    you had none).
 *  - Leaving hands the lead to the longest-standing member; the last one
 *    out disbands it and its code goes dead.
 *
 * Matchmaking reads `companionsOf()` so a party lands in one instance
 * floor after floor (net/matchmaking.ts). */

export const MAX_PARTY = 4;
export const INVITE_TTL_MS = 30_000;
export const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";
export const CODE_LENGTH = 6;

export interface Party {
  id: string;
  code: string;
  leader: string;
  /** In order of joining; the leader is always among them. */
  members: string[];
}

export type PartyError = "no-such-party" | "party-full" | "no-invite" | "already-in-it" | "not-in-a-party";

interface Invite {
  from: string;
  expires: number;
}

export function isPartyCode(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length === CODE_LENGTH && [...raw].every((c) => CODE_ALPHABET.includes(c));
}

/** Codes are typed by people: forgive case, spaces and dashes. */
export function normalizePartyCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

export class PartyDirectory {
  private parties = new Map<string, Party>();
  private byCode = new Map<string, string>();
  private partyOfPeer = new Map<string, string>();
  /** invitee → their pending invite (the newest wins). */
  private invites = new Map<string, Invite>();
  private nextId = 1;

  constructor(
    private roll: () => number = Math.random,
    private now: () => number = () => Date.now(),
    private maxSize = MAX_PARTY,
  ) {}

  partyOf(peer: string): Party | null {
    const id = this.partyOfPeer.get(peer);
    return (id && this.parties.get(id)) || null;
  }

  /** The other members of a wizard's party (matchmaking's companions). */
  companionsOf(peer: string): string[] {
    return this.partyOf(peer)?.members.filter((m) => m !== peer) ?? [];
  }

  /** Found a new party with this wizard at its head (leaving any other). */
  create(peer: string): Party {
    this.leave(peer);
    const party: Party = { id: `party_${this.nextId++}`, code: this.freshCode(), leader: peer, members: [peer] };
    this.parties.set(party.id, party);
    this.byCode.set(party.code, party.id);
    this.partyOfPeer.set(peer, party.id);
    return party;
  }

  /** Join by code. */
  join(peer: string, rawCode: string): Party | PartyError {
    const id = this.byCode.get(normalizePartyCode(rawCode));
    const party = id ? this.parties.get(id) : undefined;
    if (!party) return "no-such-party";
    return this.enter(peer, party);
  }

  /** Leave your party. Returns the party as it stands after (null if it
   * disbanded or you had none). */
  leave(peer: string): Party | null {
    const party = this.partyOf(peer);
    if (!party) return null;
    this.partyOfPeer.delete(peer);
    party.members = party.members.filter((m) => m !== peer);
    if (party.members.length === 0) {
      this.parties.delete(party.id);
      this.byCode.delete(party.code);
      return null;
    }
    if (party.leader === peer) party.leader = party.members[0]!;
    return party;
  }

  /** Invite a wizard to your party (or to found one with you). */
  invite(from: string, to: string): Invite | PartyError {
    if (from === to) return "already-in-it";
    const party = this.partyOf(from);
    if (party && party.members.includes(to)) return "already-in-it";
    if (party && party.members.length >= this.maxSize) return "party-full";
    const invite: Invite = { from, expires: this.now() + INVITE_TTL_MS };
    this.invites.set(to, invite);
    return invite;
  }

  /** The invite waiting for this wizard, if it's still good. */
  pendingInvite(peer: string): { from: string } | null {
    const inv = this.invites.get(peer);
    if (!inv || inv.expires < this.now()) return null;
    return { from: inv.from };
  }

  /** Accept the waiting invite: join the inviter's party, founding one if
   * the inviter had none (or theirs has since dissolved). */
  accept(peer: string): Party | PartyError {
    const inv = this.invites.get(peer);
    this.invites.delete(peer);
    if (!inv || inv.expires < this.now()) return "no-invite";
    let party = this.partyOf(inv.from);
    if (!party) party = this.create(inv.from);
    return this.enter(peer, party);
  }

  /** Forget a wizard entirely (disconnect). */
  forget(peer: string): Party | null {
    this.invites.delete(peer);
    for (const [to, inv] of this.invites) if (inv.from === peer) this.invites.delete(to);
    return this.leave(peer);
  }

  private enter(peer: string, party: Party): Party | PartyError {
    if (party.members.includes(peer)) return "already-in-it";
    if (party.members.length >= this.maxSize) return "party-full";
    this.leave(peer);
    party.members.push(peer);
    this.partyOfPeer.set(peer, party.id);
    return party;
  }

  private freshCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(this.roll() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
      if (!this.byCode.has(code)) return code;
    }
  }
}
