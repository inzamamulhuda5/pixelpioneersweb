import {
  AssessmentResult,
  ConversationMessage,
  DocumentFinding,
  PatientIntakeState,
} from '../types';
import { evaluateClinicalTriage } from './triageEngine';

export const initialPatientState: PatientIntakeState = {
  chiefConcern: '',
  symptoms: [],
  duration: null,
  severity: null,
  frequency: null,
  triggers: [],
  associatedSymptoms: [],
  medicalHistory: [],
  medications: [],
  allergies: [],
  lifestyleContext: [],
  activityAtOnset: null,
  age: null,
  sex: null,
  emergencyIndicators: [],
  reportedDocuments: [],
};

// Adaptive questioning heuristics & extractor
export function extractPatientStateFromTurn(
  userText: string,
  currentState: PatientIntakeState
): PatientIntakeState {
  const updated: PatientIntakeState = {
    ...currentState,
    symptoms: [...currentState.symptoms],
    triggers: [...currentState.triggers],
    associatedSymptoms: [...currentState.associatedSymptoms],
    medicalHistory: [...currentState.medicalHistory],
    medications: [...currentState.medications],
    emergencyIndicators: [...currentState.emergencyIndicators],
  };

  const lower = userText.toLowerCase();

  // Extract Chief Concern if not set
  if (!updated.chiefConcern) {
    updated.chiefConcern = userText.trim();
  }

  // Extract Duration
  if (!updated.duration) {
    const durationMatch = userText.match(
      /(\d+|one|two|three|four|five|six|seven|eight|ten|couple of|few)\s*(hour|hr|day|week|month|year|minute)s?/i
    );
    if (durationMatch) {
      updated.duration = durationMatch[0];
    } else if (lower.includes('yesterday')) {
      updated.duration = '1 day (since yesterday)';
    } else if (lower.includes('today')) {
      updated.duration = 'Today';
    } else if (lower.includes('last night')) {
      updated.duration = 'Since last night';
    }
  }

  // Extract Severity (1 to 10)
  if (updated.severity === null) {
    const numMatch = userText.match(/(?:rating|scale|severity|pain|level|is|around|about|like)?\s*(\b[1-9]\b|10)(?:\s*\/\s*10|\s*out of 10|\s*on a scale)?/i);
    if (numMatch && parseInt(numMatch[1], 10) <= 10) {
      updated.severity = parseInt(numMatch[1], 10);
    } else if (lower.includes('severe') || lower.includes('unbearable') || lower.includes('excruciating')) {
      updated.severity = 8;
    } else if (lower.includes('moderate') || lower.includes('noticeable')) {
      updated.severity = 5;
    } else if (lower.includes('mild') || lower.includes('slight')) {
      updated.severity = 3;
    }
  }

  // Extract Pattern / Frequency
  if (!updated.frequency) {
    if (lower.includes('constant') || lower.includes('all the time') || lower.includes('continuous')) {
      updated.frequency = 'constant';
    } else if (lower.includes('come and go') || lower.includes('intermittent') || lower.includes('comes and goes') || lower.includes('episodic')) {
      updated.frequency = 'intermittent';
    } else if (lower.includes('throbbing') || lower.includes('pulsing')) {
      updated.frequency = 'throbbing / episodic';
    }
  }

  // Extract Triggers / Activity
  if (lower.includes('screen') || lower.includes('computer') || lower.includes('laptop')) {
    if (!updated.triggers.includes('Screen glare / display strain')) {
      updated.triggers.push('Screen glare / display strain');
    }
  }
  if (lower.includes('stair') || lower.includes('walk') || lower.includes('exercis') || lower.includes('climb')) {
    if (!updated.triggers.includes('Physical exertion / stairs')) {
      updated.triggers.push('Physical exertion / stairs');
      updated.activityAtOnset = 'Physical exertion or climbing stairs';
    }
  }
  if (lower.includes('light') || lower.includes('bright')) {
    if (!updated.triggers.includes('Bright light (Photophobia)')) {
      updated.triggers.push('Bright light (Photophobia)');
    }
  }

  // Extract Associated Symptoms
  if (lower.includes('shortness of breath') || lower.includes('breathless') || lower.includes('hard to breathe')) {
    if (!updated.associatedSymptoms.includes('Shortness of breath')) {
      updated.associatedSymptoms.push('Shortness of breath');
      updated.emergencyIndicators.push('Exertional dyspnea');
    }
  }
  if (lower.includes('radiat') || lower.includes('arm') || lower.includes('jaw') || lower.includes('shoulder')) {
    if (!updated.associatedSymptoms.includes('Pain radiating to arm or shoulder')) {
      updated.associatedSymptoms.push('Pain radiating to arm or shoulder');
      updated.emergencyIndicators.push('Radiating pain');
    }
  }
  if (lower.includes('nausea') || lower.includes('vomit')) {
    if (!updated.associatedSymptoms.includes('Nausea')) {
      updated.associatedSymptoms.push('Nausea');
    }
  }
  if (lower.includes('fever') || lower.includes('temperature') || lower.includes('chills')) {
    if (!updated.associatedSymptoms.includes('Fever / Chills')) {
      updated.associatedSymptoms.push('Fever / Chills');
    }
  }
  if (lower.includes('dizziness') || lower.includes('lightheaded') || lower.includes('spinning')) {
    if (!updated.associatedSymptoms.includes('Dizziness / Lightheadedness')) {
      updated.associatedSymptoms.push('Dizziness / Lightheadedness');
    }
  }
  if (lower.includes('sweat') || lower.includes('cold sweat')) {
    if (!updated.associatedSymptoms.includes('Cold sweating')) {
      updated.associatedSymptoms.push('Cold sweating');
    }
  }

  // Extract Medications
  const commonMeds = ['paracetamol', 'crocin', 'dolo', 'aspirin', 'amlodipine', 'metformin', 'pantocid', 'omeprazole', 'ibuprofen'];
  commonMeds.forEach((med) => {
    if (lower.includes(med) && !updated.medications.some((m) => m.toLowerCase().includes(med))) {
      updated.medications.push(med.charAt(0).toUpperCase() + med.slice(1));
    }
  });

  // Extract Medical History
  if (lower.includes('blood pressure') || lower.includes('hypertension')) {
    if (!updated.medicalHistory.includes('Hypertension')) {
      updated.medicalHistory.push('Hypertension');
    }
  }
  if (lower.includes('diabetes') || lower.includes('sugar')) {
    if (!updated.medicalHistory.includes('Diabetes Mellitus')) {
      updated.medicalHistory.push('Diabetes Mellitus');
    }
  }
  if (lower.includes('asthma') || lower.includes('wheezing')) {
    if (!updated.medicalHistory.includes('Asthma / Bronchospasm')) {
      updated.medicalHistory.push('Asthma / Bronchospasm');
    }
  }

  // Update symptoms list
  if (updated.symptoms.length === 0 && updated.chiefConcern) {
    updated.symptoms.push({
      id: 'sym-primary',
      name: updated.chiefConcern,
      duration: updated.duration || undefined,
      severity: updated.severity || undefined,
      pattern: updated.frequency || undefined,
      triggers: updated.triggers.length > 0 ? updated.triggers : undefined,
    });
  } else if (updated.symptoms.length > 0) {
    const prim = updated.symptoms[0];
    if (updated.duration) prim.duration = updated.duration;
    if (updated.severity) prim.severity = updated.severity;
    if (updated.frequency) prim.pattern = updated.frequency;
    if (updated.triggers.length > 0) prim.triggers = updated.triggers;
  }

  return updated;
}

// Determines the next question in the clinical intake sequence
export function determineNextQuestion(
  patientState: PatientIntakeState,
  messageCount: number,
  options?: { isVoice?: boolean }
): { question: string; isComplete: boolean; quickReplies?: string[] } {
  const isVoice = options?.isVoice;

  // Check if we have gathered enough to complete interview
  const hasTiming = Boolean(patientState.duration);
  const hasSeverity = patientState.severity !== null;
  const hasPatternOrTriggers = Boolean(patientState.frequency) || patientState.triggers.length > 0;
  const hasAssociatedOrHistory = patientState.associatedSymptoms.length > 0 || patientState.medicalHistory.length > 0;

  // If already reached turn 4+ and core fields are answered, complete!
  if ((hasTiming && hasSeverity && (hasPatternOrTriggers || hasAssociatedOrHistory)) || messageCount >= 7) {
    return {
      question: isVoice
        ? 'I have enough information to prepare your assessment. You can review it now, or attach a report.'
        : 'I have enough information to prepare your health summary. You can review it below and attach a prescription or medical report if you have one.',
      isComplete: true,
      quickReplies: ['View My Assessment', 'Attach a Report', 'Find Clinics'],
    };
  }

  // Question 1: Timing
  if (!hasTiming) {
    return {
      question: isVoice
        ? 'When did you first notice this starting?'
        : 'Thank you for sharing. When did you first notice this starting?',
      isComplete: false,
      quickReplies: ['Just today', 'Yesterday', '2-3 days ago', 'More than a week ago'],
    };
  }

  // Question 2: Severity (1-10)
  if (!hasSeverity) {
    return {
      question: isVoice
        ? 'On a scale from 1 to 10, how severe is it at its peak?'
        : 'On a scale from 1 to 10, how intense or bothersome is it at its peak?',
      isComplete: false,
      quickReplies: ['Mild (2-3/10)', 'Moderate (5-6/10)', 'Severe (8/10)', 'Extreme (9-10/10)'],
    };
  }

  // Question 3: Pattern & Triggers
  if (!patientState.frequency && patientState.triggers.length === 0) {
    return {
      question: isVoice
        ? 'Has it been constant, or does it come and go in waves?'
        : 'Has it been constant, or does it come and go? Also, does anything make it better or worse?',
      isComplete: false,
      quickReplies: ['Constant ache', 'Comes and goes in waves', 'Worse during exertion', 'Worse with screens/light'],
    };
  }

  // Question 4: Associated symptoms
  if (patientState.associatedSymptoms.length === 0) {
    const isChest = patientState.chiefConcern.toLowerCase().includes('chest');
    const isHead = patientState.chiefConcern.toLowerCase().includes('head');

    if (isChest) {
      return {
        question: isVoice
          ? 'Are you feeling shortness of breath, cold sweating, or pain in your left arm?'
          : 'Are you feeling any shortness of breath, unusual cold sweating, or discomfort moving into your left arm or jaw?',
        isComplete: false,
        quickReplies: ['Yes, mild breathlessness', 'Yes, radiates to arm', 'No other symptoms'],
      };
    } else if (isHead) {
      return {
        question: isVoice
          ? 'Are you having nausea, light sensitivity, or dizziness?'
          : 'Are you experiencing any nausea, sensitivity to light, dizziness, or blurred vision?',
        isComplete: false,
        quickReplies: ['Yes, sensitive to light', 'Mild nausea', 'Dizziness', 'None of these'],
      };
    } else {
      return {
        question: isVoice
          ? 'Are you experiencing any fever, weakness, or nausea?'
          : 'Have you noticed any other symptoms alongside this, such as fever, weakness, or nausea?',
        isComplete: false,
        quickReplies: ['Fever / chills', 'Fatigue / weakness', 'Nausea', 'No other symptoms'],
      };
    }
  }

  // Final confirmation turn
  return {
    question: isVoice
      ? 'I have gathered enough information to prepare your assessment. You can review it now, or attach a report.'
      : 'I have enough information to prepare your health summary. You can review it below and attach a prescription or medical report if you would like.',
    isComplete: true,
    quickReplies: ['View My Assessment', 'Attach a Report'],
  };
}

// Call backend AI /api/ai/chat with strict error transparency (NO fake fallbacks)
export async function sendChatMessage(
  messages: ConversationMessage[],
  patientState: PatientIntakeState,
  options?: {
    signal?: AbortSignal;
    isVoice?: boolean;
  }
): Promise<{ reply: string; updatedState: PatientIntakeState; isComplete: boolean; quickReplies?: string[] }> {
  const lastUserMsg = messages[messages.length - 1];
  const userText = lastUserMsg ? lastUserMsg.content : '';

  // Update structured clinical state from turn
  const updatedState = extractPatientStateFromTurn(userText, patientState);
  const userTurnsCount = messages.filter((m) => m.role === 'user').length;
  const localGuidance = determineNextQuestion(updatedState, userTurnsCount * 2, { isVoice: options?.isVoice });

  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options?.signal,
      body: JSON.stringify({
        messages,
        patientState: updatedState,
        isVoice: options?.isVoice,
      }),
    });

    const data = await response.json().catch(() => null);

    if (response.ok && data?.reply && data.reply.trim().length > 0) {
      const isComplete =
        data.reply.toLowerCase().includes('enough information') ||
        data.reply.toLowerCase().includes('review it below') ||
        data.reply.toLowerCase().includes('review it now') ||
        data.reply.toLowerCase().includes('compile your clinical summary') ||
        data.reply.toLowerCase().includes('health summary');

      return {
        reply: data.reply,
        updatedState,
        isComplete: isComplete || localGuidance.isComplete,
        quickReplies: isComplete || localGuidance.isComplete ? ['View My Assessment', 'Attach a Report'] : localGuidance.quickReplies,
      };
    }

    // Handle server error responses transparently
    const errorMessage =
      data?.message ||
      (response.status === 503
        ? 'AI service is not configured on this deployment. Please set GEMINI_API_KEY in your Vercel project environment variables.'
        : response.status === 401
        ? 'Gemini authentication failed. Please verify that your GEMINI_API_KEY is valid.'
        : response.status === 429
        ? 'AI service is temporarily busy (quota/rate limit reached). Please try again shortly.'
        : `AI service returned error (${response.status}): ${response.statusText}`);

    throw new Error(errorMessage);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    // Transparently rethrow so the user is never deceived by prebuilt/fake responses
    throw new Error(err?.message || 'Unable to connect to Gemini AI service. Please check your connection and configuration.');
  }
}

// Document analysis parser with strict error transparency (NO fake fallbacks)
export async function analyzeUploadedDocument(
  file: File,
  base64Data: string
): Promise<DocumentFinding> {
  const res = await fetch('/api/ai/analyze-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileData: base64Data,
      fileName: file.name,
      mimeType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
    }),
  });

  const json = await res.json().catch(() => null);

  if (res.ok && json?.success && json?.data) {
    return {
      id: 'doc-' + Date.now(),
      fileName: file.name,
      fileType: file.type || 'application/pdf',
      fileSize: `${Math.round(file.size / 1024) || 1} KB`,
      uploadedAt: new Date().toISOString().split('T')[0],
      extractedTextSummary:
        json.data.extractedTextSummary ||
        'Prescription and clinical observations extracted from uploaded medical document.',
      medications: Array.isArray(json.data.medications) ? json.data.medications : [],
      priorConditions: Array.isArray(json.data.priorConditions) ? json.data.priorConditions : [],
      labFindings: Array.isArray(json.data.labFindings) ? json.data.labFindings : [],
      suggestedSpecialty: json.data.suggestedSpecialty || 'General Medicine',
      source: 'uploaded_report',
    };
  }

  const errorMessage =
    json?.message ||
    (res.status === 503
      ? 'Gemini API is not configured on this deployment. Please set GEMINI_API_KEY in your Vercel project environment variables to analyze documents.'
      : res.status === 401
      ? 'Gemini authentication failed. Please verify that your GEMINI_API_KEY is valid.'
      : res.status === 429
      ? 'AI service is temporarily busy. Please try uploading again in a moment.'
      : 'Failed to analyze document with Gemini API.');

  throw new Error(errorMessage);
}

// Builds full assessment from intake state + documents
export function buildAssessment(
  patientState: PatientIntakeState,
  documents: DocumentFinding[] = []
): AssessmentResult {
  return evaluateClinicalTriage(patientState, documents);
}
