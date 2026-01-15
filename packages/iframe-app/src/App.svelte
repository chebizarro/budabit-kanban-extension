<script lang='ts'>
  import {
    RepoKanbanClient,
    createWidgetBridge,
    type KanbanBoard,
    type KanbanCard,
    type NostrAdapter,
    type NostrEvent,
    type UnsignedEvent,
    type WidgetBridge,
  } from '@flotilla/ext-shared';

  type RepoContext = {
    contextId?: string;
    userPubkey?: string;
    relays?: string[];
    repo?: {
      repoPubkey: string;
      repoName: string;
      repoNaddr?: string;
      repoRelays: string[];
      maintainers?: string[];
    };
  };

  type RepoContextNormalized = {
    repoPubkey: string;
    repoName: string;
    repoNaddr?: string;
    repoRelays: string[];
    maintainers?: string[];
  };

  let bridge = $state<WidgetBridge | null>(null);
  let repoCtx = $state<RepoContext | null>(null);
  let client = $state<RepoKanbanClient | null>(null);

  let board = $state<KanbanBoard | null>(null);
  let cards = $state<KanbanCard[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let createOpen = $state(false);
  let createStatus = $state<string>('');
  let createTitle = $state('');
  let createDescription = $state('');

  let editOpen = $state(false);
  let editCardD = $state<string | null>(null);
  let editTitle = $state('');
  let editDescription = $state('');

  let draggingCardD = $state<string | null>(null);

  let loadSeq = 0;

  function normalizeRepo(ctx: RepoContext | null): RepoContextNormalized | null {
    const r = ctx?.repo;
    if (!r) return null;
    if (typeof r.repoPubkey !== 'string' || r.repoPubkey.length === 0) return null;
    if (typeof r.repoName !== 'string' || r.repoName.length === 0) return null;

    const fallbackRelays = Array.isArray(ctx?.relays) ? ctx.relays.filter((x) => typeof x === 'string') : [];
    const repoRelays = Array.isArray(r.repoRelays)
      ? r.repoRelays.filter((x) => typeof x === 'string')
      : fallbackRelays;

    return {
      repoPubkey: r.repoPubkey,
      repoName: r.repoName,
      repoNaddr: typeof r.repoNaddr === 'string' ? r.repoNaddr : undefined,
      repoRelays,
      maintainers: Array.isArray(r.maintainers) ? r.maintainers : undefined,
    };
  }

  function getMaintainers(r: RepoContextNormalized): string[] {
    const list = Array.isArray(r.maintainers) ? r.maintainers : [];
    const filtered = list.filter((p) => typeof p === 'string' && p.length > 0);
    return Array.from(new Set(filtered));
  }

  function makeAdapter(b: WidgetBridge): NostrAdapter {
    return {
      query: async (req) => {
        const res = await b.request('nostr:query', req);
        if (res && typeof res === 'object' && 'error' in res && typeof (res as any).error === 'string') {
          throw new Error((res as any).error);
        }
        if (res && typeof res === 'object' && 'status' in res && (res as any).status === 'ok') {
          const events = (res as any).events;
          if (Array.isArray(events)) return events as NostrEvent[];
        }
        return [];
      },

      publish: async (req) => {
        // Prefer relay-aware publish if host supports it; fallback to legacy direct-event payload.
        try {
          return await b.request('nostr:publish', ({ event: req.event, relays: req.relays } as unknown) as any);
        } catch (err) {
          if (Array.isArray(req.relays) && req.relays.length > 0) {
            return await b.request('nostr:publish', (req.event as unknown) as UnsignedEvent);
          }
          throw err;
        }
      },
    };
  }

  $effect(() => {
    const b = createWidgetBridge({
      targetWindow: window.parent,
      targetOrigin: '*',
      timeoutMs: 15000,
    });

    bridge = b;
    error = null;

    const offContext = b.onEvent('context:update', (ctx) => {
      repoCtx = (ctx ?? null) as RepoContext | null;
    });

    return () => {
      offContext();
      b.destroy();
      bridge = null;
    };
  });

  $effect(() => {
    const b = bridge;
    if (!b) {
      client = null;
      return;
    }

    const adapter = makeAdapter(b);
    client = new RepoKanbanClient(adapter);
  });

  async function loadBoardFor(r: RepoContextNormalized, c: RepoKanbanClient): Promise<void> {
    const seq = ++loadSeq;

    loading = true;
    error = null;

    try {
      const result = await c.loadRepoBoard({
        repoPubkey: r.repoPubkey,
        repoName: r.repoName,
        relays: r.repoRelays,
        maintainers: getMaintainers(r),
      });

      if (seq !== loadSeq) return;

      board = result.board;
      cards = result.cards;
    } catch (err) {
      if (seq !== loadSeq) return;

      const msg = err instanceof Error ? err.message : String(err);
      error = msg;
      board = null;
      cards = [];
    } finally {
      if (seq !== loadSeq) return;
      loading = false;
    }
  }

  $effect(() => {
    const r = normalizeRepo(repoCtx);
    const c = client;
    if (!r || !c) return;

    void loadBoardFor(r, c);
  });

  function openCreate(status: string): void {
    createOpen = true;
    createStatus = status;
    createTitle = '';
    createDescription = '';
  }

  function closeCreate(): void {
    createOpen = false;
    createTitle = '';
    createDescription = '';
  }

  function openEdit(card: KanbanCard): void {
    editOpen = true;
    editCardD = card.d;
    editTitle = card.title;
    editDescription = card.description;
  }

  function closeEdit(): void {
    editOpen = false;
    editCardD = null;
    editTitle = '';
    editDescription = '';
  }

  function nextRankForStatus(status: string): number {
    const inStatus = cards.filter((c) => c.status === status);
    const max = inStatus.reduce((m, c) => Math.max(m, Number.isFinite(c.rank) ? c.rank : 0), 0);
    return max + 10;
  }

  async function handleCreateBoard(): Promise<void> {
    const r = normalizeRepo(repoCtx);
    const c = client;
    if (!r || !c) return;

    loading = true;
    error = null;

    try {
      await c.ensureBoard({
        repoPubkey: r.repoPubkey,
        repoName: r.repoName,
        relays: r.repoRelays,
        maintainers: getMaintainers(r),
      });

      await loadBoardFor(r, c);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error = msg;
    } finally {
      loading = false;
    }
  }

  async function handleCreateCard(status: string, title: string, description: string): Promise<void> {
    const r = normalizeRepo(repoCtx);
    const c = client;
    if (!r || !c) return;
    if (!board) return;

    const t = title.trim();
    const d = description.trim();
    if (!t) return;

    loading = true;
    error = null;

    try {
      const newRank = nextRankForStatus(status);
      await c.createCard({
        board,
        relays: r.repoRelays,
        title: t,
        description: d,
        status,
        rank: newRank,
      });

      // Optimistically add card to local state
      const optimisticCard: KanbanCard = {
        d: `temp-${Date.now()}`,
        title: t,
        description: d,
        status,
        rank: newRank,
        pubkey: '',
        created_at: Math.floor(Date.now() / 1000),
        assignees: [],
        attachments: [],
      };
      cards = [...cards, optimisticCard];

      closeCreate();

      // Reload after a short delay to get the real card from relay
      setTimeout(() => void loadBoardFor(r, c), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error = msg;
    } finally {
      loading = false;
    }
  }

  async function handleSaveEdit(): Promise<void> {
    const r = normalizeRepo(repoCtx);
    const c = client;
    if (!r || !c) return;
    if (!board) return;
    if (!editCardD) return;

    const existing = cards.find((x) => x.d === editCardD);
    if (!existing) {
      closeEdit();
      return;
    }

    const t = editTitle.trim();
    if (!t) return;

    loading = true;
    error = null;

    try {
      await c.updateCard({
        board,
        relays: r.repoRelays,
        cardD: existing.d,
        title: t,
        description: editDescription.trim(),
        status: existing.status,
        rank: existing.rank,
      });

      closeEdit();
      await loadBoardFor(r, c);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error = msg;
    } finally {
      loading = false;
    }
  }

  async function handleMoveCard(card: KanbanCard, newStatus: string): Promise<void> {
    const r = normalizeRepo(repoCtx);
    const c = client;
    if (!r || !c) return;
    if (!board) return;

    if (card.status === newStatus) return;

    loading = true;
    error = null;

    try {
      await c.updateCard({
        board,
        relays: r.repoRelays,
        cardD: card.d,
        title: card.title,
        description: card.description,
        status: newStatus,
        rank: nextRankForStatus(newStatus),
      });

      await loadBoardFor(r, c);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error = msg;
    } finally {
      loading = false;
    }
  }

  function onCardDragStart(e: DragEvent, card: KanbanCard): void {
    draggingCardD = card.d;
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', card.d);
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  function onCardDragEnd(): void {
    draggingCardD = null;
  }

  async function onColumnDrop(e: DragEvent, status: string): Promise<void> {
    e.preventDefault();
    const d = e.dataTransfer?.getData('text/plain') ?? draggingCardD;
    if (!d) return;

    const card = cards.find((c) => c.d === d);
    if (!card) return;

    await handleMoveCard(card, status);
  }

  function onColumnDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function cardsForStatus(status: string): KanbanCard[] {
    return cards.filter((c) => c.status === status).slice().sort((a, b) => a.rank - b.rank);
  }

  function reload(): void {
    const r = normalizeRepo(repoCtx);
    const c = client;
    if (!r || !c) return;
    void loadBoardFor(r, c);
  }
</script>

<div class='app'>
  <header class='header'>
    <div class='title'>
      <h1>Repo Kanban</h1>
      {#if repoCtx?.repo}
        <p class='subtitle'>
          {repoCtx.repo.repoName}
          <span class='muted'>({repoCtx.repo.repoPubkey.slice(0, 12)}...)</span>
        </p>
      {:else}
        <p class='subtitle muted'>Waiting for host context...</p>
      {/if}
    </div>

    <div class='header-actions'>
      <button type='button' class='btn' onclick={reload} disabled={!repoCtx?.repo || !client || loading}>
        Reload
      </button>
    </div>
  </header>

  {#if error}
    <div class='alert alert-error'>
      <strong>Error:</strong> {error}
    </div>
  {/if}

  {#if loading && !board}
    <section class='loading-state'>
      <div class='spinner'></div>
      <p class='muted'>Loading board...</p>
    </section>
  {:else if repoCtx?.repo}
    {#if board}
      <section class='board'>
        {#if loading}
          <div class='loading-overlay'>
            <div class='spinner'></div>
          </div>
        {/if}
        <div class='board-meta'>
          <h2 class='board-title'>{board.title}</h2>
          {#if board.description}
            <p class='board-desc'>{board.description}</p>
          {/if}
        </div>

        <div class='columns'>
          {#each board.columns as col (col.id)}
            <div class='column' ondrop={(e) => void onColumnDrop(e, col.id)} ondragover={onColumnDragOver}>
              <div class='column-header'>
                <h3>{col.name}</h3>
                <button type='button' class='btn btn-small' onclick={() => openCreate(col.id)} disabled={loading}>
                  + Card
                </button>
              </div>

              <div class='cards'>
                {#each cardsForStatus(col.id) as card (card.d)}
                  <div
                    class='card'
                    draggable='true'
                    ondragstart={(e) => onCardDragStart(e, card)}
                    ondragend={onCardDragEnd}
                    onclick={() => openEdit(card)}
                    role='button'
                    tabindex='0'
                    onkeydown={(e) => e.key === 'Enter' && openEdit(card)}
                  >
                    <div class='card-title'>{card.title}</div>
                    {#if card.description}
                      <div class='card-desc'>{card.description}</div>
                    {/if}
                    <div class='card-meta'>
                      <span class='pill'>{card.status}</span>
                      <span class='muted'>rank {card.rank}</span>
                    </div>
                  </div>
                {/each}

                {#if cardsForStatus(col.id).length === 0}
                  <div class='empty muted'>No cards</div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {:else}
      <section class='empty-state'>
        <h2>No board found for this repo</h2>
        <p class='muted'>
          This widget stores Kanban data on Nostr (NIP-100). Create a board to start tracking work.
        </p>
        <button type='button' class='btn btn-primary' onclick={() => void handleCreateBoard()} disabled={loading}>
          Create board
        </button>
      </section>
    {/if}
  {:else}
    <section class='empty-state'>
      <h2>Waiting for host repo context</h2>
      <p class='muted'>
        The host should send <code>context:update</code> including <code>repo.repoPubkey</code>, <code>repo.repoName</code>, and
        <code>repo.repoRelays</code>.
      </p>
    </section>
  {/if}

  {#if createOpen}
    <div class='modal-backdrop' onclick={closeCreate} role='presentation'>
      <div class='modal' onclick={(e) => e.stopPropagation()} role='dialog' aria-modal='true' tabindex='-1'>
        <h3>Create card</h3>

        <form class='form' onsubmit={(e) => { e.preventDefault(); void handleCreateCard(createStatus, createTitle, createDescription); }}>
          <label>
            <span>Status</span>
            <input type='text' bind:value={createStatus} readonly />
          </label>

          <label>
            <span>Title</span>
            <input type='text' bind:value={createTitle} placeholder='Card title' autofocus />
          </label>

          <label>
            <span>Description</span>
            <textarea bind:value={createDescription} placeholder='Optional description' rows='4'></textarea>
          </label>

          <div class='modal-actions'>
            <button type='button' class='btn' onclick={closeCreate} disabled={loading}>
              Cancel
            </button>
            <button type='submit' class='btn btn-primary' disabled={loading || !createTitle.trim()}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  {#if editOpen && editCardD}
    <div class='modal-backdrop' onclick={closeEdit} role='presentation'>
      <div class='modal' onclick={(e) => e.stopPropagation()} role='dialog' aria-modal='true' tabindex='-1'>
        <h3>Edit card</h3>

        <form class='form' onsubmit={(e) => { e.preventDefault(); void handleSaveEdit(); }}>
          <label>
            <span>Title</span>
            <input type='text' bind:value={editTitle} autofocus />
          </label>

          <label>
            <span>Description</span>
            <textarea bind:value={editDescription} rows='4'></textarea>
          </label>

          <div class='modal-actions'>
            <button type='button' class='btn' onclick={closeEdit} disabled={loading}>
              Cancel
            </button>
            <button type='submit' class='btn btn-primary' disabled={loading || !editTitle.trim()}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>

<style>
  /* REPOMARK:SCOPE: 3 - Replace styles to support a simple Kanban board layout with columns, cards, and modals */
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: #f6f7f9;
    color: #1f2328;
  }

  code {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    padding: 0.1rem 0.25rem;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.9em;
  }

  .app {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.25rem;
  }

  .header {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .title h1 {
    margin: 0;
    font-size: 1.5rem;
  }

  .subtitle {
    margin: 0.25rem 0 0 0;
    font-size: 0.95rem;
  }

  .muted {
    color: #6b7280;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .btn {
    appearance: none;
    border: 1px solid #d0d7de;
    background: #ffffff;
    color: #1f2328;
    border-radius: 8px;
    padding: 0.45rem 0.75rem;
    cursor: pointer;
    font-size: 0.95rem;
  }

  .btn:hover:not(:disabled) {
    background: #f3f4f6;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #0969da;
    color: #ffffff;
    border-color: #0969da;
  }

  .btn-primary:hover:not(:disabled) {
    background: #0757b3;
  }

  .btn-small {
    padding: 0.35rem 0.55rem;
    font-size: 0.85rem;
    border-radius: 7px;
  }

  .alert {
    border-radius: 10px;
    padding: 0.75rem 0.9rem;
    margin-bottom: 1rem;
    border: 1px solid #d0d7de;
    background: #ffffff;
  }

  .alert-error {
    border-color: #f5c2c7;
    background: #fff5f5;
    color: #7f1d1d;
  }

  .empty-state {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 1.25rem;
  }

  .empty-state h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.15rem;
  }

  .board {
    position: relative;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 3rem;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
  }

  .loading-overlay {
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    border-radius: 12px;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #e5e7eb;
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .board-meta {
    margin-bottom: 0.75rem;
  }

  .board-title {
    margin: 0;
    font-size: 1.2rem;
  }

  .board-desc {
    margin: 0.25rem 0 0 0;
    color: #6b7280;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(3, minmax(240px, 1fr));
    gap: 0.9rem;
  }

  @media (max-width: 900px) {
    .columns {
      grid-template-columns: 1fr;
    }
  }

  .column {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 0.75rem;
    min-height: 320px;
  }

  .column-header {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .column-header h3 {
    margin: 0;
    font-size: 1rem;
    color: #374151;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .card {
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    background: #fbfbfc;
    padding: 0.75rem;
    cursor: pointer;
  }

  .card:hover {
    border-color: #c7d2fe;
    background: #f8fafc;
  }

  .card-title {
    font-weight: 600;
    margin-bottom: 0.35rem;
  }

  .card-desc {
    color: #4b5563;
    font-size: 0.92rem;
    margin-bottom: 0.5rem;
    white-space: pre-wrap;
  }

  .card-meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    font-size: 0.82rem;
  }

  .pill {
    display: inline-block;
    border: 1px solid #d1d5db;
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    background: #ffffff;
    color: #374151;
  }

  .empty {
    padding: 0.75rem;
    text-align: center;
    border: 1px dashed #e5e7eb;
    border-radius: 10px;
    background: #ffffff;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(17, 24, 39, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 50;
  }

  .modal {
    width: 100%;
    max-width: 560px;
    background: #ffffff;
    border-radius: 14px;
    border: 1px solid #e5e7eb;
    padding: 1rem;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
  }

  .modal h3 {
    margin: 0 0 0.75rem 0;
    font-size: 1.1rem;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
    color: #374151;
  }

  input[type='text'],
  textarea {
    border: 1px solid #d1d5db;
    border-radius: 10px;
    padding: 0.55rem 0.65rem;
    font-size: 1rem;
    font-family: inherit;
  }

  textarea {
    resize: vertical;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
</style>
