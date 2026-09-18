import { slotsService } from '../../server/slotsService.ts';
import { sendResponse } from '../../server/responseHelper.ts';

export default async function handler(req: any, res: any) {
  const url = new URL(req.url, 'http://localhost');
  const doctorId = url.searchParams.get('doctorId') || req.query?.doctorId;
  const date = url.searchParams.get('date') || req.query?.date;
  const sessionId = url.searchParams.get('sessionId') || req.query?.sessionId;

  const result = slotsService.getAvailability({ doctorId, date, sessionId });
  return sendResponse(res, 200, result);
}
