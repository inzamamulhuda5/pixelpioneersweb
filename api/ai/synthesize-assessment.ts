import { geminiService, GeminiServiceError } from '../../server/geminiService.ts';
import { sendResponse } from '../../server/responseHelper.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendResponse(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are accepted' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { patientState, documentFindings } = body;

    if (!patientState) {
      return sendResponse(res, 400, {
        error: 'INVALID_REQUEST',
        message: 'patientState is required',
      });
    }

    const data = await geminiService.generateAssessment({
      patientState,
      documentFindings: documentFindings || [],
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
      error: 'ASSESSMENT_SYNTHESIS_FAILED',
      message: error?.message || 'Failed to synthesize assessment with Gemini',
    });
  }
}
