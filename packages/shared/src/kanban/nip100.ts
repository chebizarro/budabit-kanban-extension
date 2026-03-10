import type { NostrEvent, UnsignedEvent } from '../types.js';
import type { KanbanBoard, KanbanCard, KanbanColumn } from './types.js';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function firstTagValue(tags: string[][], name: string): string | undefined {
  for (const t of tags) {
    if (t[0] === name && typeof t[1] === 'string') return t[1];
  }
  return undefined;
}

function firstTagValueOr(tags: string[][], name: string, fallback: string): string {
  return firstTagValue(tags, name) ?? fallback;
}

function allTagValues(tags: string[][], name: string): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (t[0] === name && typeof t[1] === 'string') out.push(t[1]);
  }
  return out;
}

function normalizeColumns(columns: KanbanColumn[]): KanbanColumn[] {
  return [...columns].sort((a, b) => a.order - b.order);
}

function selectLatest(events: NostrEvent[]): NostrEvent | null {
  if (events.length === 0) return null;
  return events.reduce((best, ev) => {
    if (!best) return ev;
    if ((ev.created_at ?? 0) > (best.created_at ?? 0)) return ev;
    if ((ev.created_at ?? 0) < (best.created_at ?? 0)) return best;

    // Tie-breaker: prefer lexicographically larger id if present (stable-ish).
    const a = ev.id ?? '';
    const b = best.id ?? '';
    return a > b ? ev : best;
  }, events[0] as NostrEvent);
}

/**
 * Deterministic board `d` tag for a repo-scoped Kanban board.
 * Format: `budabit-kanban:${repoPubkey}:${repoName}`
 */
export function boardDForRepo(repoPubkey: string, repoName: string): string {
  return `budabit-kanban:${repoPubkey}:${repoName}`;
}

/**
 * NIP-100 board reference string used in card `a` tags.
 * Format: `30301:<boardPubkey>:<boardD>`
 */
export function boardATag(boardPubkey: string, boardD: string): string {
  return `30301:${boardPubkey}:${boardD}`;
}

export function buildBoardEvent(input: {
  d: string;
  title: string;
  description: string;
  columns: KanbanColumn[];
  maintainers: string[];
  cardScale?: number;
}): UnsignedEvent {
  const tags: string[][] = [];

  tags.push(['d', input.d]);
  tags.push(['title', input.title]);
  tags.push(['description', input.description]);

  const cols = normalizeColumns(input.columns);
  for (const col of cols) {
    tags.push(['col', col.id, col.name, String(col.order)]);
  }

  for (const p of input.maintainers) {
    if (typeof p === 'string' && p.length > 0) tags.push(['p', p]);
  }

  if (typeof input.cardScale === 'number' && input.cardScale !== 1.0) {
    tags.push(['card_scale', String(input.cardScale)]);
  }

  return {
    kind: 30301,
    content: '',
    tags,
    created_at: nowSeconds(),
  };
}

export function buildCardEvent(input: {
  boardATag: string;
  d: string;
  title: string;
  description: string;
  status: string;
  rank: number;
  assignees?: string[];
  attachments?: string[];
}): UnsignedEvent {
  const tags: string[][] = [];

  tags.push(['d', input.d]);
  tags.push(['title', input.title]);
  tags.push(['description', input.description]);
  tags.push(['s', input.status]);
  tags.push(['rank', String(input.rank)]);
  tags.push(['a', input.boardATag]);

  for (const p of input.assignees ?? []) {
    if (typeof p === 'string' && p.length > 0) tags.push(['p', p]);
  }

  for (const u of input.attachments ?? []) {
    if (typeof u === 'string' && u.length > 0) tags.push(['u', u]);
  }

  return {
    kind: 30302,
    content: '',
    tags,
    created_at: nowSeconds(),
  };
}

/**
 * Choose authoritative board event:
 * - Prefer a board authored by repoPubkey (latest by created_at)
 * - Else choose the latest board authored by any maintainer
 */
export function selectAuthoritativeBoardEvent(
  events: NostrEvent[],
  opts: { repoPubkey: string; maintainers: string[] },
): NostrEvent | null {
  const boardEvents = events.filter((e) => e && e.kind === 30301 && Array.isArray(e.tags));

  const byRepoOwner = boardEvents.filter((e) => e.pubkey === opts.repoPubkey);
  const bestRepo = selectLatest(byRepoOwner);
  if (bestRepo) return bestRepo;

  const maintainerSet = new Set(opts.maintainers);
  const byMaintainers = boardEvents.filter((e) => maintainerSet.has(e.pubkey));
  return selectLatest(byMaintainers);
}

export function parseBoard(event: NostrEvent): KanbanBoard {
  const tags = Array.isArray(event.tags) ? event.tags : [];

  const d = firstTagValueOr(tags, 'd', '');
  const title = firstTagValueOr(tags, 'title', 'Kanban');
  const description = firstTagValueOr(tags, 'description', '');

  const columns: KanbanColumn[] = [];
  for (const t of tags) {
    if (t[0] !== 'col') continue;
    const id = typeof t[1] === 'string' ? t[1] : '';
    const name = typeof t[2] === 'string' ? t[2] : '';
    const orderRaw = typeof t[3] === 'string' ? t[3] : '0';
    const order = Number.parseInt(orderRaw, 10);
    if (!id) continue;
    columns.push({ id, name, order: Number.isFinite(order) ? order : 0 });
  }

  const maintainers = allTagValues(tags, 'p');

  const cardScaleRaw = firstTagValue(tags, 'card_scale');
  const cardScaleParsed = cardScaleRaw ? Number.parseFloat(cardScaleRaw) : undefined;
  const cardScale = cardScaleParsed && Number.isFinite(cardScaleParsed) ? cardScaleParsed : undefined;

  return {
    d,
    pubkey: event.pubkey,
    title,
    description,
    columns: normalizeColumns(columns),
    maintainers,
    cardScale,
  };
}

/**
 * Parse NIP-100 cards, applying the rule:
 * If multiple card events share the same `d`, take the latest (created_at) among allowed authors.
 */
export function parseCards(
  events: NostrEvent[],
  opts: { allowedAuthors: string[] },
): KanbanCard[] {
  const allowed = new Set(opts.allowedAuthors);

  const candidates = events.filter((e) => {
    if (!e || e.kind !== 30302) return false;
    if (!Array.isArray(e.tags)) return false;
    if (opts.allowedAuthors.length > 0 && !allowed.has(e.pubkey)) return false;
    return true;
  });

  const latestByD = new Map<string, NostrEvent>();

  for (const ev of candidates) {
    const d = firstTagValue(ev.tags, 'd');
    if (!d) continue;

    const prev = latestByD.get(d);
    if (!prev) {
      latestByD.set(d, ev);
      continue;
    }

    const a = ev.created_at ?? 0;
    const b = prev.created_at ?? 0;

    if (a > b) latestByD.set(d, ev);
    if (a === b) {
      const idA = ev.id ?? '';
      const idB = prev.id ?? '';
      if (idA > idB) latestByD.set(d, ev);
    }
  }

  const out: KanbanCard[] = [];
  for (const ev of latestByD.values()) {
    const tags = ev.tags ?? [];
    const d = firstTagValueOr(tags, 'd', '');
    if (!d) continue;

    const title = firstTagValueOr(tags, 'title', '');
    const description = firstTagValueOr(tags, 'description', '');
    const status = firstTagValueOr(tags, 's', '');
    const rankRaw = firstTagValueOr(tags, 'rank', '0');
    const rankNum = Number.parseInt(rankRaw, 10);
    const rank = Number.isFinite(rankNum) ? rankNum : 0;

    const assignees = allTagValues(tags, 'p');
    const attachments = allTagValues(tags, 'u');

    out.push({
      d,
      eventId: ev.id,
      pubkey: ev.pubkey,
      title,
      description,
      status,
      rank,
      assignees,
      attachments,
      created_at: ev.created_at,
    });
  }

  out.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return (a.created_at ?? 0) - (b.created_at ?? 0);
  });

  return out;
}