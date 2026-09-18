import { geminiService, GeminiServiceError } from '../../server/geminiService.ts';
import { sendResponse } from '../../server/responseHelper.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendResponse(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are accepted' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { messages, patientState, isVoice } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return sendResponse(res, 400, {
        error: 'INVALID_REQUEST',
        message: 'messages array is required and must contain at least one message',
      });
    }

    const result = await geminiService.generateChatResponse({
      messages,
      patientState,
      isVoice: Boolean(isVoice),
    });

    return sendResponse(res, 200, {
      reply: result.reply,
      model: result.model,
      source: 'gemini',
    });
  } catch (error: any) {
    if (error instanceof GeminiServiceError) {
      return sendResponse(res, error.statusCode, {
        error: error.errorCode,
        message: error.message,
        source: 'gemini_error',
      });
    }

    const status = error?.statusCode || error?.status || 500;
    return sendResponse(res, status, {
      error: 'CHAT_GENERATION_FAILED',
      message: error?.message || 'Failed to generate AI response',
      source: 'gemini_error',
    });
  }
}
