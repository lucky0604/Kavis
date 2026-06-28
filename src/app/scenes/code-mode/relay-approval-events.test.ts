import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApprovalCardData } from './InspectorPane';
import { applyApprovalStreamEvent, attachApprovalHandlers, submitApprovalResponse } from './relay-approval-events';

describe('relay-approval-events', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates pending approval card from approval_required', () => {
    const next = applyApprovalStreamEvent([], {
      type: 'approval_required',
      data: {
        id: 'ap-1',
        name: 'patch_file',
        path: 'src/foo.ts',
        contentPreview: 'preview',
        unifiedDiff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n+line',
        bytes: 42,
      },
    });
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe('pending');
    expect(next[0].unifiedDiff).toContain('+++ b/src/foo.ts');
  });

  it('updates status on approval_resolved', () => {
    const cards: ApprovalCardData[] = [{
      id: 'ap-1',
      title: 'Write',
      description: 'x',
      status: 'pending',
    }];
    const next = applyApprovalStreamEvent(cards, {
      type: 'approval_resolved',
      data: { id: 'ap-1', approved: true },
    });
    expect(next[0].status).toBe('approved');
  });

  it('submitApprovalResponse posts to API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const ok = await submitApprovalResponse('ap-1', true);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/approval', expect.objectContaining({ method: 'POST' }));
  });

  it('attachApprovalHandlers wires approve callback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const updates: string[] = [];
    const card = attachApprovalHandlers({
      id: 'ap-1',
      title: 'Patch',
      description: 'src/a.ts',
      status: 'pending',
    }, (id, status) => updates.push(`${id}:${status}`));

    await card.onApprove?.();
    expect(updates).toEqual(['ap-1:approved']);
  });
});
