import { geminiService, GeminiServiceError } from '../../server/geminiService.ts';
import { sendResponse } from '../../server/responseHelper.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendResponse(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are accepted' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { fileData, fileName = 'medical_report.pdf', mimeType = 'application/pdf' } = body;

    if (!fileData) {
      return sendResponse(res, 400, {
        error: 'INVALID_REQUEST',
        message: 'fileData (base64) is required for document analysis',
      });
    }

    const data = await geminiService.analyzeDocument({
      fileData,
      fileName,
      mimeType,
    });

    return sendResponse(res, 200, {
      success: true,
      data,
      source: 'gemini',
    });
  } catch (error: any) {
    if (error instanceof GeminiServiceError) {
      return sendResponse(res, error.statusCode, {
        success: false,
        error: error.errorCode,
        message: error.message,
      });
    }

    const status = error?.statusCode || error?.status || 500;
    return sendResponse(res, status, {
      success: false,
      error: 'DOCUMENT_ANALYSIS_FAILED',
      message: error?.message || 'Failed to analyze document with Gemini',
    });
  }
}
