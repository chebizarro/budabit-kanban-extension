export type KanbanColumn = { id: string; name: string; order: number };

export type KanbanBoard = {
  d: string;
  pubkey: string;
  title: string;
  description: string;
  columns: KanbanColumn[];
  maintainers: string[];
  cardScale?: number; // Font scale for cards (0.5 to 2.0, default 1.0)
};

export type KanbanCard = {
  d: string;
  eventId?: string;
  pubkey?: string;
  title: string;
  description: string;
  status: string;
  rank: number;
  assignees: string[];
  attachments: string[];
  created_at?: number;
};