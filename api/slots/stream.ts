import { slotsService } from '../../server/slotsService.ts';

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  slotsService.addSseClient(res);

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);

  req.on('close', () => {
    slotsService.removeSseClient(res);
  });
}
