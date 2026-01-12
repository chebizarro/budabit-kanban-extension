import type { NostrEvent, UnsignedEvent } from '../types.js';
import type { KanbanBoard, KanbanCard, KanbanColumn } from './types.js';
import {
  boardATag,
  boardDForRepo,
  buildBoardEvent,
  buildCardEvent,
  parseBoard,
  parseCards,
  selectAuthoritativeBoardEvent,
} from './nip100.js';

export interface NostrAdapter {
  query(req: { relays: string[]; filter: Record<string, unknown> }): Promise<NostrEvent[]>;
  publish(req: { event: UnsignedEvent; relays?: string[] }): Promise<unknown>;
}

export type LoadRepoContext = {
  repoPubkey: string;
  repoName: string;
  relays: string[];
  maintainers: string[];
};

export type EnsureBoardContext = LoadRepoContext & {
  title?: string;
  description?: string;
};

function defaultColumns(): KanbanColumn[] {
  return [
    { id: 'todo', name: 'To Do', order: 0 },
    { id: 'in-progress', name: 'In Progress', order: 1 },
    { id: 'done', name: 'Done', order: 2 },
  ];
}

function randomCardD(): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const rand = Math.random().toString(16).slice(2);
  return `card-${Date.now()}-${rand}`;
}

export class RepoKanbanClient {
  constructor(private nostr: NostrAdapter) {}

  async loadRepoBoard(ctx: LoadRepoContext): Promise<{ board: KanbanBoard | null; cards: KanbanCard[] }> {
    const d = boardDForRepo(ctx.repoPubkey, ctx.repoName);

    const boardEvents = await this.nostr.query({
      relays: ctx.relays,
      filter: {
        kinds: [30301],
        '#d': [d],
        limit: 50,
      },
    });

    const boardEvent = selectAuthoritativeBoardEvent(boardEvents, {
      repoPubkey: ctx.repoPubkey,
      maintainers: ctx.maintainers,
    });

    if (!boardEvent) {
      return { board: null, cards: [] };
    }

    const board = parseBoard(boardEvent);
    const a = boardATag(board.pubkey, board.d);

    const cardEvents = await this.nostr.query({
      relays: ctx.relays,
      filter: {
        kinds: [30302],
        '#a': [a],
        limit: 500,
      },
    });

    const allowedAuthors = Array.from(new Set([board.pubkey, ...board.maintainers]));
    const cards = parseCards(cardEvents, { allowedAuthors });

    return { board, cards };
  }

  async ensureBoard(ctx: EnsureBoardContext): Promise<KanbanBoard> {
    const loaded = await this.loadRepoBoard(ctx);
    if (loaded.board) return loaded.board;

    const d = boardDForRepo(ctx.repoPubkey, ctx.repoName);
    const title = ctx.title ?? `Kanban: ${ctx.repoName}`;
    const description = ctx.description ?? '';

    const ev = buildBoardEvent({
      d,
      title,
      description,
      columns: defaultColumns(),
      maintainers: ctx.maintainers,
    });

    await this.nostr.publish({ event: ev, relays: ctx.relays });

    const reloaded = await this.loadRepoBoard(ctx);
    if (!reloaded.board) {
      throw new Error('Failed to create or load board after publishing.');
    }
    return reloaded.board;
  }

  async createCard(input: {
    board: KanbanBoard;
    relays: string[];
    title: string;
    description: string;
    status: string;
    rank: number;
    assignees?: string[];
    attachments?: string[];
  }): Promise<void> {
    const a = boardATag(input.board.pubkey, input.board.d);
    const d = randomCardD();

    const ev = buildCardEvent({
      boardATag: a,
      d,
      title: input.title,
      description: input.description,
      status: input.status,
      rank: input.rank,
      assignees: input.assignees,
      attachments: input.attachments,
    });

    await this.nostr.publish({ event: ev, relays: input.relays });
  }

  async updateCard(input: {
    board: KanbanBoard;
    relays: string[];
    cardD: string;
    title: string;
    description: string;
    status: string;
    rank: number;
    assignees?: string[];
    attachments?: string[];
  }): Promise<void> {
    const a = boardATag(input.board.pubkey, input.board.d);

    const ev = buildCardEvent({
      boardATag: a,
      d: input.cardD,
      title: input.title,
      description: input.description,
      status: input.status,
      rank: input.rank,
      assignees: input.assignees,
      attachments: input.attachments,
    });

    await this.nostr.publish({ event: ev, relays: input.relays });
  }
}