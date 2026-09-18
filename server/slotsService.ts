import fs from 'fs';
import path from 'path';

export interface ServerSlotHold {
  slotId: string;
  doctorId: string;
  date: string;
  time: string;
  sessionId: string;
  heldAt: number;
  expiresAt: number;
  label?: string;
}

export interface ServerSlotBooked {
  slotId: string;
  doctorId?: string;
  date?: string;
  time?: string;
  bookedAt: number;
  patientName?: string;
}

class SlotsService {
  private serverHeldSlots = new Map<string, ServerSlotHold>();
  private serverBookedSlots = new Map<string, ServerSlotBooked>();
  private sseClients = new Set<any>();
  private cacheFilePath: string;

  constructor() {
    this.cacheFilePath = path.join(process.cwd(), '.slots_cache.json');
    this.loadSlotsCache();

    // Periodic hold expiration check
    setInterval(() => {
      if (this.cleanupExpiredHolds()) {
        this.broadcastSlotUpdate({ type: 'HOLDS_EXPIRED', timestamp: Date.now() });
      }
    }, 2000);
  }

  private loadSlotsCache() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf-8'));
        const now = Date.now();
        if (Array.isArray(data.heldSlots)) {
          for (const h of data.heldSlots) {
            if (h && h.expiresAt > now) {
              this.serverHeldSlots.set(h.slotId, h);
            }
          }
        }
        if (Array.isArray(data.bookedSlots)) {
          for (const b of data.bookedSlots) {
            if (typeof b === 'string') {
              this.serverBookedSlots.set(b, { slotId: b, bookedAt: now });
            } else if (b && b.slotId) {
              this.serverBookedSlots.set(b.slotId, b);
            }
          }
        }
      }
    } catch {
      // Ignore cache load issues
    }
  }

  private saveSlotsCache() {
    try {
      const data = {
        heldSlots: Array.from(this.serverHeldSlots.values()),
        bookedSlots: Array.from(this.serverBookedSlots.values()),
      };
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(data), 'utf-8');
    } catch {
      // Ignore cache write issues
    }
  }

  public cleanupExpiredHolds(): boolean {
    const now = Date.now();
    let changed = false;
    for (const [slotId, hold] of this.serverHeldSlots.entries()) {
      if (hold.expiresAt <= now) {
        this.serverHeldSlots.delete(slotId);
        changed = true;
      }
    }
    if (changed) {
      this.saveSlotsCache();
    }
    return changed;
  }

  public broadcastSlotUpdate(eventData: any = { type: 'SLOTS_UPDATED', timestamp: Date.now() }) {
    const payload = `data: ${JSON.stringify(eventData)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  public addSseClient(client: any) {
    this.sseClients.add(client);
  }

  public removeSseClient(client: any) {
    this.sseClients.delete(client);
  }

  public getAvailability(query: { doctorId?: string; date?: string; sessionId?: string }) {
    this.cleanupExpiredHolds();
    const { doctorId, date, sessionId = '' } = query;

    const activeHolds: Record<
      string,
      {
        slotId: string;
        doctorId: string;
        date: string;
        time: string;
        expiresAt: number;
        heldByMe: boolean;
        label: string;
      }
    > = {};

    const now = Date.now();
    for (const [slotId, hold] of this.serverHeldSlots.entries()) {
      if (hold.expiresAt > now) {
        if ((!doctorId || hold.doctorId === doctorId) && (!date || hold.date === date)) {
          const isHeldByMe = Boolean(sessionId && hold.sessionId === sessionId);
          activeHolds[slotId] = {
            slotId,
            doctorId: hold.doctorId,
            date: hold.date,
            time: hold.time,
            expiresAt: hold.expiresAt,
            heldByMe: isHeldByMe,
            label: isHeldByMe ? 'Held for you' : 'Held by patient',
          };
        }
      }
    }

    const bookedList: string[] = [];
    for (const [slotId, b] of this.serverBookedSlots.entries()) {
      if ((!doctorId || !b.doctorId || b.doctorId === doctorId) && (!date || !b.date || b.date === date)) {
        bookedList.push(slotId);
      }
    }

    return {
      success: true,
      serverTime: now,
      heldSlots: activeHolds,
      bookedSlots: bookedList,
    };
  }

  public holdSlot(body: {
    slotId: string;
    doctorId?: string;
    date?: string;
    time?: string;
    sessionId: string;
    durationSeconds?: number;
  }) {
    this.cleanupExpiredHolds();
    const { slotId, doctorId = '', date = '', time = '', sessionId, durationSeconds = 300 } = body;

    if (!slotId || !sessionId) {
      return { status: 400, data: { success: false, message: 'slotId and sessionId are required' } };
    }

    if (this.serverBookedSlots.has(slotId)) {
      return {
        status: 409,
        data: {
          success: false,
          message: 'This slot was just booked by another patient. Please choose an available slot.',
        },
      };
    }

    const existingHold = this.serverHeldSlots.get(slotId);
    if (existingHold && existingHold.expiresAt > Date.now() && existingHold.sessionId !== sessionId) {
      return {
        status: 409,
        data: {
          success: false,
          message: 'This slot is currently held by another patient. Please choose another available slot.',
        },
      };
    }

    // Release any previous slot held by THIS session
    for (const [id, h] of this.serverHeldSlots.entries()) {
      if (h.sessionId === sessionId && id !== slotId) {
        this.serverHeldSlots.delete(id);
      }
    }

    const expiresAt = Date.now() + durationSeconds * 1000;
    const holdRecord: ServerSlotHold = {
      slotId,
      doctorId,
      date,
      time,
      sessionId,
      heldAt: Date.now(),
      expiresAt,
      label: 'Held for you',
    };

    this.serverHeldSlots.set(slotId, holdRecord);
    this.saveSlotsCache();

    this.broadcastSlotUpdate({
      type: 'SLOT_HELD',
      slotId,
      doctorId,
      date,
      time,
      sessionId,
      expiresAt,
    });

    return {
      status: 200,
      data: {
        success: true,
        slotId,
        heldUntil: expiresAt,
        message: 'Slot held successfully across devices',
      },
    };
  }

  public releaseSlot(body: { slotId?: string; sessionId?: string }) {
    const { slotId, sessionId } = body;
    let changed = false;

    if (slotId) {
      const existing = this.serverHeldSlots.get(slotId);
      if (existing && (!sessionId || existing.sessionId === sessionId)) {
        this.serverHeldSlots.delete(slotId);
        changed = true;
      }
    } else if (sessionId) {
      for (const [id, h] of this.serverHeldSlots.entries()) {
        if (h.sessionId === sessionId) {
          this.serverHeldSlots.delete(id);
          changed = true;
        }
      }
    }

    if (changed) {
      this.saveSlotsCache();
      this.broadcastSlotUpdate({
        type: 'SLOT_RELEASED',
        slotId,
        sessionId,
        timestamp: Date.now(),
      });
    }

    return { status: 200, data: { success: true } };
  }

  public bookSlot(body: {
    slotId: string;
    doctorId?: string;
    date?: string;
    time?: string;
    sessionId?: string;
    appointment?: any;
  }) {
    this.cleanupExpiredHolds();
    const { slotId, doctorId, date, time, sessionId, appointment } = body;

    if (!slotId) {
      return { status: 400, data: { success: false, message: 'slotId is required' } };
    }

    if (this.serverBookedSlots.has(slotId)) {
      return {
        status: 409,
        data: {
          success: false,
          message: 'This slot is no longer available. Another patient just completed booking this time.',
        },
      };
    }

    const existingHold = this.serverHeldSlots.get(slotId);
    if (existingHold && existingHold.expiresAt > Date.now() && existingHold.sessionId !== sessionId) {
      return {
        status: 409,
        data: {
          success: false,
          message: 'This slot is currently held by another patient and cannot be booked.',
        },
      };
    }

    this.serverBookedSlots.set(slotId, {
      slotId,
      doctorId: doctorId || appointment?.doctor?.id || '',
      date: date || appointment?.date || '',
      time: time || appointment?.time || '',
      bookedAt: Date.now(),
      patientName: appointment?.patientName,
    });

    this.serverHeldSlots.delete(slotId);
    this.saveSlotsCache();

    this.broadcastSlotUpdate({
      type: 'SLOT_BOOKED',
      slotId,
      doctorId,
      date,
      time,
      timestamp: Date.now(),
    });

    return { status: 200, data: { success: true, slotId, appointment } };
  }
}

export const slotsService = new SlotsService();
