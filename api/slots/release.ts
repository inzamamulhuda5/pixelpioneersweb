import { slotsService } from '../../server/slotsService.ts';
import { sendResponse } from '../../server/responseHelper.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendResponse(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const result = slotsService.releaseSlot(body);
  return sendResponse(res, result.status, result.data);
}
