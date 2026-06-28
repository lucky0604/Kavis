import type { ApprovalCardData } from './InspectorPane';

export async function submitApprovalResponse(approvalId: string, approved: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/chat/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId, approved }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function applyApprovalStreamEvent(
  approvals: ApprovalCardData[],
  event: { type: string; data: unknown },
): ApprovalCardData[] {
  if (event.type === 'approval_required') {
    const data = event.data as {
      id?: string;
      name?: string;
      path?: string;
      contentPreview?: string;
      unifiedDiff?: string;
      bytes?: number;
    };
    if (!data.id) return approvals;

    const title = data.name === 'patch_file' ? 'Patch approval' : 'Write approval';
    const description = `${data.path ?? 'file'} · ${(data.bytes ?? 0).toLocaleString()} bytes`;

    return [
      ...approvals.filter((a) => a.id !== data.id),
      {
        id: data.id,
        title,
        description,
        diff: data.unifiedDiff || data.contentPreview,
        unifiedDiff: data.unifiedDiff,
        contentPreview: data.contentPreview,
        path: data.path,
        status: 'pending',
      },
    ];
  }

  if (event.type === 'approval_resolved') {
    const data = event.data as { id?: string; approved?: boolean };
    if (!data.id) return approvals;
    return approvals.map((a) =>
      a.id === data.id
        ? { ...a, status: data.approved ? 'approved' : 'denied' }
        : a,
    );
  }

  return approvals;
}

export function attachApprovalHandlers(
  card: ApprovalCardData,
  onUpdate: (id: string, status: 'approved' | 'denied') => void,
): ApprovalCardData {
  return {
    ...card,
    onApprove: async () => {
      const ok = await submitApprovalResponse(card.id, true);
      if (ok) onUpdate(card.id, 'approved');
    },
    onDeny: async () => {
      const ok = await submitApprovalResponse(card.id, false);
      if (ok) onUpdate(card.id, 'denied');
    },
  };
}
