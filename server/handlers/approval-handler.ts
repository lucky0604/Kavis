import type { IncomingMessage, ServerResponse } from 'http';
import { resolveToolApproval } from '../work-mode/tool-approval';
import { readBody } from '../shared/utils/read-body';

export async function handleApprovalRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const approvalId = typeof body.approvalId === 'string' ? body.approvalId : '';
  const approved = body.approved === true;

  if (!approvalId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'approvalId required' }));
    return;
  }

  const ok = resolveToolApproval(approvalId, approved);
  if (!ok) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Approval not found or already resolved' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}
