import { GoogleGenAI } from '@google/genai';

export interface ChatMessageParam {
  role: 'user' | 'assistant' | 'model' | 'system';
  content: string;
}

export interface PatientIntakeSummary {
  chiefConcern?: string;
  symptoms?: Array<{
    id?: string;
    name: string;
    duration?: string;
    severity?: number;
    pattern?: string;
    triggers?: string[];
  }>;
  duration?: string | null;
  severity?: number | null;
  frequency?: string | null;
  triggers?: string[];
  associatedSymptoms?: string[];
  medicalHistory?: string[];
  medications?: string[];
  emergencyIndicators?: string[];
}

export interface DocumentAnalysisResult {
  extractedTextSummary: string;
  medications: string[];
  priorConditions: string[];
  labFindings: string[];
  suggestedSpecialty?: string;
}

export interface AssessmentResultPayload {
  summary: string;
  recommendedSpecialty: string;
  specialtyRationale: string;
  riskTier?: 'low' | 'moderate' | 'high' | 'urgent';
  riskIndicators?: string[];
}

export class GeminiServiceError extends Error {
  statusCode: number;
  errorCode: string;

  constructor(message: string, statusCode: number = 500, errorCode: string = 'GEMINI_ERROR') {
    super(message);
    this.name = 'GeminiServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

export class GeminiService {
  private client: GoogleGenAI | null = null;
  private currentKey: string | null = null;

  /**
   * Reads and validates the Gemini API key from the server environment.
   * Supports GEMINI_API_KEY (primary) and GOOGLE_API_KEY (fallback).
   */
  public getApiKey(): string {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!key || key.trim() === '' || key === 'MY_GEMINI_API_KEY') {
      throw new GeminiServiceError(
        'Gemini API is not configured on this deployment. Please set GEMINI_API_KEY in your Vercel project environment variables (or server environment).',
        503,
        'API_KEY_MISSING'
      );
    }
    return key.trim();
  }

  /**
   * Returns true if a valid Gemini API key is configured.
   */
  public hasValidKey(): boolean {
    try {
      this.getApiKey();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lazy initializes the GoogleGenAI client with server-side credentials and telemetry header.
   */
  public getClient(): GoogleGenAI {
    const apiKey = this.getApiKey();
    if (!this.client || this.currentKey !== apiKey) {
      this.client = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      this.currentKey = apiKey;
    }
    return this.client;
  }

  /**
   * Maps SDK / Network errors into user-safe HTTP status codes and messages.
   * Logs only sanitized metadata (no API keys, no sensitive patient PHI).
   */
  private handleGeminiError(error: any, requestType: string): never {
    const rawMsg = error?.message || String(error);
    const status = error?.status || error?.statusCode || 500;

    // Safe sanitized logging
    console.error(`[GeminiService] Request failed:`, {
      type: requestType,
      status,
      timestamp: new Date().toISOString(),
      errorName: error?.name || 'Error',
      snippet: rawMsg.slice(0, 150),
    });

    if (error instanceof GeminiServiceError) {
      throw error;
    }

    // 401 Authentication Failure
    if (
      status === 401 ||
      rawMsg.includes('API_KEY_INVALID') ||
      rawMsg.includes('API key not valid') ||
      rawMsg.includes('401')
    ) {
      throw new GeminiServiceError(
        'Gemini authentication failed. Please verify that your GEMINI_API_KEY is valid and active in Google AI Studio.',
        401,
        'AUTH_FAILED'
      );
    }

    // 403 Permission Denied / Project Restriction
    if (
      status === 403 ||
      rawMsg.includes('PERMISSION_DENIED') ||
      rawMsg.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
      rawMsg.includes('blocked') ||
      rawMsg.includes('403')
    ) {
      throw new GeminiServiceError(
        'Gemini API request was rejected by the configured API key or project restrictions.',
        403,
        'PERMISSION_DENIED'
      );
    }

    // 429 Rate Limit / Quota Exceeded
    if (
      status === 429 ||
      rawMsg.includes('RESOURCE_EXHAUSTED') ||
      rawMsg.includes('quota') ||
      rawMsg.includes('429')
    ) {
      throw new GeminiServiceError(
        'AI service is temporarily busy (rate limit/quota reached). Please try again shortly.',
        429,
        'RATE_LIMITED'
      );
    }

    // 504 Deadline Exceeded / Timeout
    if (
      status === 504 ||
      rawMsg.includes('DEADLINE_EXCEEDED') ||
      rawMsg.includes('timeout') ||
      rawMsg.includes('AbortError')
    ) {
      throw new GeminiServiceError(
        'AI response timed out. Please try again.',
        504,
        'TIMEOUT'
      );
    }

    // Generic error
    throw new GeminiServiceError(
      `Gemini service error: ${rawMsg.replace(/key=[^&\s]+/gi, 'key=REDACTED')}`,
      status >= 400 && status < 600 ? status : 500,
      'UPSTREAM_ERROR'
    );
  }

  /**
   * Executes a generateContent call with model fallback and bounded retry.
   */
  private async executeWithFallback(
    params: {
      contents: any;
      config?: any;
      models?: string[];
      timeoutMs?: number;
    },
    requestType: string
  ): Promise<{ text: string; modelUsed: string }> {
    const client = this.getClient();
    // Models: gemini-3.1-flash-lite (fast, high throughput) and gemini-3.8-flash
    const models = params.models || ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
    const timeoutMs = params.timeoutMs || 25000;

    let lastError: any = null;

    for (const model of models) {
      try {
        // Timeout wrapper
        const timeoutPromise = new Promise((_, reject) => {
          const timer = setTimeout(() => {
            reject(new GeminiServiceError('AI response timed out. Please try again.', 504, 'TIMEOUT'));
          }, timeoutMs);
          if (typeof timer.unref === 'function') timer.unref();
        });

        const generatePromise = client.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        });

        const response = (await Promise.race([generatePromise, timeoutPromise])) as any;

        const text = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text.trim().length > 0) {
          return { text: text.trim(), modelUsed: model };
        }
      } catch (err: any) {
        lastError = err;
        const status = err?.status || err?.statusCode;
        const msg = err?.message || '';

        // Do NOT retry authentication or permission errors or missing key errors
        if (
          status === 401 ||
          status === 403 ||
          msg.includes('API_KEY') ||
          err instanceof GeminiServiceError
        ) {
          this.handleGeminiError(err, requestType);
        }

        // Continue to fallback model immediately
        continue;
      }
    }

    return this.handleGeminiError(lastError, requestType);
  }

  /**
   * Generates dynamic clinical intake chat responses with empathetic tone, safety guardrails,
   * and single-question progression.
   */
  public async generateChatResponse(params: {
    messages: ChatMessageParam[];
    patientState?: PatientIntakeSummary;
    isVoice?: boolean;
  }): Promise<{ reply: string; model: string; source: 'gemini' }> {
    const { messages, patientState, isVoice } = params;

    const voiceConstraint = isVoice
      ? `
CRITICAL VOICE MODE RULES:
- The user is conversing via spoken audio. Your response will be spoken aloud to them.
- Keep your entire response to 1 or 2 short, natural sentences (maximum 35 words).
- Acknowledge what the user shared in a few words, then ask strictly ONE single question.
- NEVER ask multiple questions in a turn.
- Check patientState: If duration is already known, do NOT ask for duration. If severity is already rated (1-10), do NOT ask for severity.
- When sufficient details are gathered, say: "I have gathered enough information to prepare your assessment. You can review it below or attach a report."`
      : '';

    const systemInstruction = `You are Pixel Pioneers Clinical Intake Assistant, a calm, friendly, empathetic, non-judgmental healthcare coordination assistant.
IMPORTANT SAFETY BOUNDARIES:
- You are an intake coordinator, NOT a diagnosing physician.
- Never provide a definitive diagnosis or prescribe medication.
- Use safe phrasing like "Based on what you've shared...", "Symptoms like this may be associated with...".
- Ask ONE concise, relevant follow-up question at a time.
- Do NOT dump lists of questions. Be natural, conversational, and directly responsive to what the patient says.
- If the user asks a general question (e.g. "Hello, tell me what you can help me with"), explain warmly that you can guide them through an intake of their symptoms, help attach medical reports, and coordinate care with relevant doctors and clinics.
- Target collecting: chief concern, duration, severity (1-10), pattern (constant vs coming and going), triggers or activity at onset, and key associated symptoms.
- If you already have enough information (or 4-5 turns have passed and key questions are answered), inform the user: "I have gathered enough information to compile your clinical summary and transparent triage assessment. You can proceed to view your assessment or attach any prescriptions/reports if you have them."
- Detect emergency red-flags (crushing chest pain radiating to arm/jaw, acute shortness of breath, sudden facial drooping/slurred speech, severe hemorrhage) and prominently advise immediate emergency medical care (e.g. 102/112 or nearest emergency department).${voiceConstraint}`;

    const contents = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    // Add state context if available
    let contextualConfig: any = {
      systemInstruction,
      temperature: 0.35,
      maxOutputTokens: isVoice ? 100 : 400,
    };

    const result = await this.executeWithFallback(
      {
        contents,
        config: contextualConfig,
      },
      'chat'
    );

    return {
      reply: result.text,
      model: result.modelUsed,
      source: 'gemini',
    };
  }

  /**
   * Analyzes an uploaded medical document (prescription, lab report, imaging result)
   * supporting both PDF and image formats (JPEG, PNG, WebP) via base64 multimodal input.
   */
  public async analyzeDocument(params: {
    fileData: string; // Base64 string
    fileName: string;
    mimeType?: string;
  }): Promise<DocumentAnalysisResult> {
    const { fileData, fileName, mimeType = 'application/pdf' } = params;

    if (!fileData || fileData.trim().length === 0) {
      throw new GeminiServiceError(
        'No document data received for analysis. Please upload a valid PDF or image document.',
        400,
        'INVALID_DOCUMENT'
      );
    }

    const prompt = `You are an expert clinical document analyzer. Analyze this uploaded medical document or prescription (${fileName}) carefully.
Extract structured clinical findings:
1. Patient name, age, or sex if clearly stated (do NOT invent or guess).
2. Medications listed (name, dosage, frequency, and instructions if present).
3. Stated clinical impressions, diagnoses, or reasons for referral.
4. Relevant lab values, vital signs, test results, or clinical observations.
5. Recommended clinical specialty (e.g., Cardiology, Dermatology, Neurology, Orthopedics, Gastroenterology, ENT, Pediatrics, General Medicine).

Format your response strictly as valid JSON with this exact schema:
{
  "extractedTextSummary": "Clear 2-3 sentence overview of the key clinical content in the document",
  "medications": ["Medication 1 with dosage", "Medication 2 with dosage"],
  "priorConditions": ["Condition or diagnosis 1", "Condition 2"],
  "labFindings": ["Finding or test result 1 with values and reference", "Finding 2"],
  "suggestedSpecialty": "One of: General Medicine | Cardiology | Neurology | Dermatology | Orthopedics | Gastroenterology | ENT | Pediatrics"
}`;

    const contents = {
      parts: [
        {
          inlineData: {
            mimeType: mimeType || 'application/pdf',
            data: fileData,
          },
        },
        { text: prompt },
      ],
    };

    const result = await this.executeWithFallback(
      {
        contents,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      },
      'analyze-document'
    );

    try {
      const parsed = JSON.parse(result.text);
      return {
        extractedTextSummary:
          parsed.extractedTextSummary ||
          `Document analyzed by Gemini: ${parsed.suggestedSpecialty || 'Clinical'} findings extracted.`,
        medications: Array.isArray(parsed.medications) ? parsed.medications : [],
        priorConditions: Array.isArray(parsed.priorConditions) ? parsed.priorConditions : [],
        labFindings: Array.isArray(parsed.labFindings) ? parsed.labFindings : [],
        suggestedSpecialty: parsed.suggestedSpecialty || 'General Medicine',
      };
    } catch {
      return {
        extractedTextSummary: result.text.slice(0, 300),
        medications: [],
        priorConditions: [],
        labFindings: [],
        suggestedSpecialty: 'General Medicine',
      };
    }
  }

  /**
   * Generates a clinical assessment narrative and specialty triage recommendation.
   */
  public async generateAssessment(params: {
    patientState: PatientIntakeSummary;
    documentFindings?: DocumentAnalysisResult[];
  }): Promise<AssessmentResultPayload> {
    const { patientState, documentFindings = [] } = params;

    const prompt = `Based strictly on the following patient intake data and document findings, generate a concise clinical narrative summary and specialty recommendation.
Patient Intake Data: ${JSON.stringify(patientState)}
Document Findings: ${JSON.stringify(documentFindings)}

Rules:
- Do NOT make a definitive diagnosis.
- State what symptoms were reported, their duration, severity, and pattern.
- Return valid JSON with:
{
  "summary": "Short 2-3 sentence clinical narrative...",
  "recommendedSpecialty": "General Medicine | Cardiology | Neurology | Dermatology | Orthopedics | Gastroenterology | ENT | Pediatrics",
  "specialtyRationale": "Brief 1-sentence reason for this specialty choice.",
  "riskTier": "low | moderate | high | urgent",
  "riskIndicators": ["Specific reason 1", "Specific reason 2"]
}`;

    const result = await this.executeWithFallback(
      {
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      },
      'assessment'
    );

    try {
      const parsed = JSON.parse(result.text);
      return {
        summary: parsed.summary || 'Clinical intake completed. Further evaluation recommended with a specialist.',
        recommendedSpecialty: parsed.recommendedSpecialty || 'General Medicine',
        specialtyRationale: parsed.specialtyRationale || 'Based on reported symptoms and clinical intake.',
        riskTier: parsed.riskTier || 'moderate',
        riskIndicators: Array.isArray(parsed.riskIndicators) ? parsed.riskIndicators : [],
      };
    } catch {
      return {
        summary: result.text.slice(0, 300),
        recommendedSpecialty: 'General Medicine',
        specialtyRationale: 'Based on patient intake summary.',
        riskTier: 'moderate',
        riskIndicators: [],
      };
    }
  }

  /**
   * Evaluates clinical risk indicators for intake data.
   */
  public async generateRiskIndicators(params: {
    patientState: PatientIntakeSummary;
    documentFindings?: DocumentAnalysisResult[];
  }): Promise<{ riskTier: 'low' | 'moderate' | 'high' | 'urgent'; indicators: string[] }> {
    const assessment = await this.generateAssessment(params);
    return {
      riskTier: assessment.riskTier || 'moderate',
      indicators: assessment.riskIndicators || [],
    };
  }

  /**
   * Generates a single targeted interview question based on current intake gaps.
   */
  public async generateInterviewQuestion(params: {
    patientState: PatientIntakeSummary;
    turnsCount: number;
    isVoice?: boolean;
  }): Promise<string> {
    const { patientState, turnsCount, isVoice } = params;
    const prompt = `You are a clinical intake assistant.
Current state of patient intake: ${JSON.stringify(patientState)}
Turns so far: ${turnsCount}.
Target to collect if missing: duration, severity on 1-10 scale, constant vs episodic pattern, triggers, and any associated symptoms.
Generate strictly ONE empathetic question to ask the patient next.${isVoice ? ' Keep it under 25 words.' : ''}`;

    const result = await this.executeWithFallback(
      {
        contents: prompt,
        config: {
          temperature: 0.3,
          maxOutputTokens: 80,
        },
      },
      'interview-question'
    );

    return result.text;
  }

  /**
   * Prepares a session configuration for voice intake.
   */
  public createVoiceSession(): { sessionId: string; serverTime: number; hasValidKey: boolean } {
    return {
      sessionId: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      serverTime: Date.now(),
      hasValidKey: this.hasValidKey(),
    };
  }

  /**
   * Health check returning service status.
   */
  public checkHealth(): {
    status: string;
    hasGeminiKey: boolean;
    models: string[];
    timestamp: string;
  } {
    return {
      status: 'ok',
      hasGeminiKey: this.hasValidKey(),
      models: ['gemini-3.8-flash', 'gemini-3.1-flash-lite'],
      timestamp: new Date().toISOString(),
    };
  }
}

export const geminiService = new GeminiService();
