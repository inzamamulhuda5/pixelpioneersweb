import { geminiService } from '../server/geminiService.ts';
import { sendResponse } from '../server/responseHelper.ts';

export default async function handler(req: any, res: any) {
  const health = geminiService.checkHealth();
  return sendResponse(res, 200, health);
}
