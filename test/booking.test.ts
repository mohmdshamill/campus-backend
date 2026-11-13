import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/db';
import { BookingService } from '../src/modules/bookings/bookings.service';
import { Role } from '@prisma/client';
import { EventService } from '../src/modules/events/events.service';

const TAG = 'Automated Test';

/** Build an ISO timestamp for a college-local (IST) date + "HH:mm". */
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();

/** YYYY-MM-DD (IST) for N days from now. */
const dayFromNow = (n: number) => {
  const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
};

/** Next given weekday (IST), at least 7 days away. */
const nextWeekday = (name: string) => {
  for (let n = 7; n < 15; n++) {
    const s = dayFromNow(n);
    if (new Date(`${s}T12:00:00+05:30`).toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }) === name) return s;
  }
  throw new Error('no ' + name);
};
const nextMonday = () => nextWeekday('Monday');

describe('Booking validation & conflict rules', () => {
  let student: any; // Computer Department student
  let lab: any; // Software Development & Database Lab (08:30-16:30)
  let auditorium: any;
  let sciLab: any;
  let bcaClass: any; // has a Monday 09:00-10:30 timetable entry

  const book = (resourceId: string, date: string, from: string, to: string, purpose = `${TAG} booking`) =>
    BookingService.createBooking(
      { resourceId, startDateTime: ist(date, from), endDateTime: ist(date, to), purpose, attendeesCount: 2 },
      student.id,
      student.email
    );

  const rejectsWith = async (p: Promise<unknown>, status: number, text: RegExp) =>
    assert.rejects(p, (err: any) => {
      assert.equal(err.statusCode, status, `expected ${status}, got ${err.statusCode}: ${err.message}`);
      assert.match(err.message, text);
      return true;
    });

  before(async () => {
    student = await prisma.user.findFirst({
      where: { role: Role.STUDENT, department: { code: 'COMP' } },
    });
    lab = await prisma.resource.findFirst({ where: { code: 'LAB-COMP-105' } });
    auditorium = await prisma.resource.findFirst({ where: { code: 'AUD-MAIN-01' } });
    sciLab = await prisma.resource.findFirst({ where: { code: 'LAB-SCI-PHY' } });
    bcaClass = await prisma.resource.findFirst({ where: { code: 'CLS-COMP-BCA1' } });
    assert.ok(student && lab && auditorium && sciLab && bcaClass, 'Run `npm run prisma:seed` first');
  });

  it('creates a valid booking inside operating hours', async () => {
    const b = await book(lab.id, dayFromNow(10), '09:00', '10:30');
    assert.ok(b.id);
  });

  it('rejects an overlapping slot and names who booked it', async () => {
    await rejectsWith(book(lab.id, dayFromNow(10), '09:30', '11:00'), 409, /Already (booked|requested) by .*9:00 AM - 10:30 AM/);
  });

  it('allows back-to-back bookings (end == next start)', async () => {
    const b = await book(lab.id, dayFromNow(10), '10:30', '11:30');
    assert.ok(b.id);
  });

  it('allows the same time on a different day', async () => {
    const b = await book(lab.id, dayFromNow(11), '09:00', '10:30');
    assert.ok(b.id);
  });

  it('rejects booking outside operating hours (lab closes 4:30 PM)', async () => {
    await rejectsWith(book(lab.id, dayFromNow(12), '16:00', '17:30'), 400, /must be within 8:30 AM - 4:30 PM/);
    await rejectsWith(book(lab.id, dayFromNow(12), '07:30', '09:00'), 400, /must be within/);
  });

  it('has no maximum duration (full-day lab booking is fine)', async () => {
    const b = await book(lab.id, nextWeekday('Sunday'), '08:30', '16:30'); // Sunday: no timetable classes
    assert.ok(b.id);
  });

  it('rejects end time not after start time', async () => {
    await rejectsWith(book(lab.id, dayFromNow(14), '11:00', '10:00'), 400, /Start time must be/);
    await rejectsWith(book(lab.id, dayFromNow(14), '11:00', '11:00'), 400, /Start time must be/);
  });

  it('auditorium has no time limit (night event allowed)', async () => {
    const b = await book(auditorium.id, dayFromNow(10), '19:00', '23:30');
    assert.ok(b.id);
    await rejectsWith(book(auditorium.id, dayFromNow(10), '22:00', '23:00'), 409, /Already (booked|requested) by/);
  });

  it('conflicts with the academic timetable', async () => {
    await rejectsWith(book(bcaClass.id, nextMonday(), '09:30', '10:00'), 409, /Already booked: BCA 1st Year/);
  });

  it('students cannot book another department\'s lab', async () => {
    await rejectsWith(book(sciLab.id, dayFromNow(10), '10:00', '11:00'), 403, /own department/);
  });

  it('blocks bookings AND events while a venue is under maintenance', async () => {
    const hall = await prisma.resource.findFirst({ where: { code: 'SEM-MAIN-01' } });
    const reporter = await prisma.user.findFirst({ where: { role: Role.SUPER_ADMIN } });
    const date = dayFromNow(20);
    await prisma.maintenanceRecord.create({
      data: {
        resourceId: hall!.id,
        reportedById: reporter!.id,
        title: `${TAG} projector repair`,
        description: 'Test maintenance window',
        startDateTime: new Date(ist(date, '10:00')),
        endDateTime: new Date(ist(date, '14:00')),
        status: 'REPORTED',
        priority: 'MEDIUM',
      },
    });
    await rejectsWith(book(hall!.id, date, '12:00', '13:00'), 409, /maintenance/i);
    await rejectsWith(
      (EventService as any).validateEventConflicts(hall!.id, new Date(ist(date, '13:00')), new Date(ist(date, '15:00'))),
      409,
      /under maintenance on .*10:00 AM - 2:00 PM/
    );
    // outside the maintenance window is fine
    const ok = await book(hall!.id, date, '14:00', '15:00');
    assert.ok(ok.id);
  });

  it('no auto-approval: coordinator bookings stay PENDING but are visible to the coordinator', async () => {
    const coord = await prisma.user.findFirst({ where: { role: Role.COORDINATOR, department: { code: 'COMM' } } });
    const commLab = await prisma.resource.findFirst({ where: { code: 'LAB-COMM-001' } });
    const date = dayFromNow(25);
    const own = await BookingService.createBooking(
      { resourceId: commLab!.id, startDateTime: ist(date, '10:00'), endDateTime: ist(date, '11:00'), purpose: `${TAG} coord own dept` },
      coord!.id,
      coord!.email
    );
    assert.equal(own.status, 'PENDING');
    const list = await BookingService.listBookings({ limit: 100 }, { id: coord!.id, role: Role.COORDINATOR, departmentId: coord!.departmentId });
    assert.ok(list.bookings.some((b: any) => b.id === own.id));
  });

  it('a rejected request still blocks the same date & time; a cancelled one frees it', async () => {
    const date = dayFromNow(30);
    const b = await book(lab.id, date, '09:00', '10:00');
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'REJECTED' } });
    await rejectsWith(book(lab.id, date, '09:00', '10:00'), 409, /not available/);
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
    const again = await book(lab.id, date, '09:00', '10:00');
    assert.ok(again.id);
  });

  after(async () => {
    await prisma.maintenanceRecord.deleteMany({ where: { title: { contains: TAG } } });
    await prisma.bookingStatusHistory.deleteMany({ where: { booking: { purpose: { contains: TAG } } } });
    await prisma.notification.deleteMany({ where: { booking: { purpose: { contains: TAG } } } });
    await prisma.booking.deleteMany({ where: { purpose: { contains: TAG } } });
  });
});
