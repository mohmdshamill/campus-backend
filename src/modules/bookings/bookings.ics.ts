import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/db';

const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (v: string) => v.replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');

// iCalendar export so students can drop upcoming bookings into Google/Outlook/Apple Calendar.
export async function exportMyBookingsIcs(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await prisma.booking.findMany({
      where: {
        userId: req.user!.id,
        status: { in: ['APPROVED', 'PENDING'] },
        endDateTime: { gte: new Date() },
      },
      include: { resource: { select: { name: true, building: true } } },
      orderBy: { startDateTime: 'asc' },
    });

    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Campus Connect//Bookings//EN', 'CALSCALE:GREGORIAN'];
    for (const b of rows) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${b.id}@campusconnect`,
        `DTSTAMP:${fmt(new Date())}`,
        `DTSTART:${fmt(b.startDateTime)}`,
        `DTEND:${fmt(b.endDateTime)}`,
        `SUMMARY:${esc(`${b.resource.name} (${b.status})`)}`,
        `DESCRIPTION:${esc(`${b.bookingCode} - ${b.purpose}`)}`,
        `LOCATION:${esc(b.resource.building || b.resource.name)}`,
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my-bookings.ics"');
    return res.send(lines.join('\r\n'));
  } catch (error) {
    next(error);
  }
}
