import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { geminiService, GeminiServiceError } from './server/geminiService.ts';
import { slotsService } from './server/slotsService.ts';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json(geminiService.checkHealth());
});

// AI Chat endpoint with server-side Gemini
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const { messages, patientState, isVoice } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'messages array is required and must contain at least one message',
      });
    }

    const result = await geminiService.generateChatResponse({
      messages,
      patientState,
      isVoice: Boolean(isVoice),
    });

    return res.json({
      reply: result.reply,
      model: result.model,
      source: 'gemini',
    });
  } catch (error: any) {
    if (error instanceof GeminiServiceError) {
      return res.status(error.statusCode).json({
        error: error.errorCode,
        message: error.message,
        source: 'gemini_error',
      });
    }

    const status = error?.statusCode || error?.status || 500;
    return res.status(status).json({
      error: 'CHAT_GENERATION_FAILED',
      message: error?.message || 'Failed to generate AI response',
      source: 'gemini_error',
    });
  }
});

// AI Document Analysis endpoint
app.post('/api/ai/analyze-document', async (req: Request, res: Response) => {
  try {
    const { fileData, fileName, mimeType } = req.body;

    if (!fileData) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_REQUEST',
        message: 'fileData (base64) is required for document analysis',
      });
    }

    const data = await geminiService.analyzeDocument({
      fileData,
      fileName: fileName || 'medical_document.pdf',
      mimeType: mimeType || 'application/pdf',
    });

    return res.json({
      success: true,
      data,
      source: 'gemini',
    });
  } catch (error: any) {
    if (error instanceof GeminiServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.errorCode,
        message: error.message,
      });
    }

    const status = error?.statusCode || error?.status || 500;
    return res.status(status).json({
      success: false,
      error: 'DOCUMENT_ANALYSIS_FAILED',
      message: error?.message || 'Failed to analyze document with Gemini',
    });
  }
});

// AI Synthesis & Assessment endpoint
app.post('/api/ai/synthesize-assessment', async (req: Request, res: Response) => {
  try {
    const { patientState, documentFindings } = req.body;

    if (!patientState) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_REQUEST',
        message: 'patientState is required',
      });
    }

    const data = await geminiService.generateAssessment({
      patientState,
      documentFindings: documentFindings || [],
    });

    return res.json({
      success: true,
      data,
      source: 'gemini',
    });
  } catch (error: any) {
    if (error instanceof GeminiServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.errorCode,
        message: error.message,
      });
    }

    const status = error?.statusCode || error?.status || 500;
    return res.status(status).json({
      success: false,
      error: 'ASSESSMENT_SYNTHESIS_FAILED',
      message: error?.message || 'Failed to synthesize assessment with Gemini',
    });
  }
});

// ================= GLOBAL CROSS-DEVICE SLOT HOLD & BOOKING SYSTEM =================

// SSE Stream for real-time cross-device slot synchronization
app.get('/api/slots/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  slotsService.addSseClient(res);

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);

  req.on('close', () => {
    slotsService.removeSseClient(res);
  });
});

// Get global slot availability across all devices
app.get('/api/slots/availability', (req: Request, res: Response) => {
  const { doctorId, date, sessionId } = req.query as {
    doctorId?: string;
    date?: string;
    sessionId?: string;
  };
  const result = slotsService.getAvailability({ doctorId, date, sessionId });
  res.json(result);
});

// Hold a slot across all devices
app.post('/api/slots/hold', (req: Request, res: Response) => {
  const result = slotsService.holdSlot(req.body);
  res.status(result.status).json(result.data);
});

// Release a slot hold
app.post('/api/slots/release', (req: Request, res: Response) => {
  const result = slotsService.releaseSlot(req.body);
  res.status(result.status).json(result.data);
});

// Confirm booking and permanently book slot
app.post('/api/slots/book', (req: Request, res: Response) => {
  const result = slotsService.bookSlot(req.body);
  res.status(result.status).json(result.data);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pixel Pioneers server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
