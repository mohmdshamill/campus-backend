import {
  PrismaClient,
  Role,
  ResourceType,
  ResourceMaintenanceStatus,
  DayOfWeek,
  EquipmentCondition,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SHARED_TYPES: ResourceType[] = [ResourceType.AUDITORIUM, ResourceType.SEMINAR_HALL, ResourceType.MEETING_ROOM];
const YEAR_LABEL = ['1st', '2nd', '3rd'];

async function main() {
  console.log('🌱 Seeding Campus Connect...');

  // ---- Clear everything (children first) ----
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.bookingStatusHistory.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.maintenanceRecord.deleteMany();
  await prisma.collegeEvent.deleteMany();
  await prisma.academicSchedule.deleteMany();
  await prisma.equipmentTransaction.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.departmentMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
  await prisma.systemSetting.deleteMany();

  // ---- System settings ----
  await prisma.systemSetting.createMany({
    data: [
      { key: 'COLLEGE_NAME', value: 'Campus Connect Arts & Science College', description: 'Institution Name' },
      { key: 'DEFAULT_TIMEZONE', value: 'Asia/Kolkata', description: 'Institutional Timezone' },
    ],
  });

  // ---- Departments ----
  const comp = await prisma.department.create({
    data: {
      name: 'Computer Department',
      code: 'COMP',
      description: 'BCA, BSc Artificial Intelligence, BSc Computer Science',
    },
  });
  const comm = await prisma.department.create({
    data: {
      name: 'Commerce Department',
      code: 'COMM',
      description: 'B.Com, B.Com Finance, B.Com CA, B.Com Corporate, BBA, B.Voc',
    },
  });
  const sci = await prisma.department.create({
    data: {
      name: 'Science Department',
      code: 'SCI',
      description: 'BSc Physics, BSc Chemistry, BSc Mathematics',
    },
  });

  // ---- Users ----
  const pw = await bcrypt.hash('Password123!', 10);
  const mkUser = (
    name: string,
    email: string,
    role: Role,
    collegeId: string,
    departmentId?: string
  ) =>
    prisma.user.create({
      data: { name, email, passwordHash: pw, role, collegeId, departmentId, isActive: true },
    });

  await mkUser('Super Admin', 'admin@campusconnect.edu', Role.SUPER_ADMIN, 'ADM-001');
  await mkUser('Website Admin', 'webadmin@campusconnect.edu', Role.WEBSITE_ADMIN, 'WEB-001');
  const cComp = await mkUser('Computer Coordinator', 'coordinator.comp@campusconnect.edu', Role.COORDINATOR, 'FAC-COMP-01', comp.id);
  const cComm = await mkUser('Commerce Coordinator', 'coordinator.comm@campusconnect.edu', Role.COORDINATOR, 'FAC-COMM-01', comm.id);
  const cSci = await mkUser('Science Coordinator', 'coordinator.sci@campusconnect.edu', Role.COORDINATOR, 'FAC-SCI-01', sci.id);

  await prisma.departmentMembership.createMany({
    data: [
      { userId: cComp.id, departmentId: comp.id, roleInDept: 'HEAD_COORDINATOR', isPrimary: true },
      { userId: cComm.id, departmentId: comm.id, roleInDept: 'HEAD_COORDINATOR', isPrimary: true },
      { userId: cSci.id, departmentId: sci.id, roleInDept: 'HEAD_COORDINATOR', isPrimary: true },
    ],
  });

  await mkUser('Rohan (BCA)', 'rohan.bca@student.campusconnect.edu', Role.STUDENT, 'STU-BCA-001', comp.id);
  await mkUser('Aisha (BSc AI)', 'aisha.ai@student.campusconnect.edu', Role.STUDENT, 'STU-AI-001', comp.id);
  await mkUser('Meera (B.Com)', 'meera.bcom@student.campusconnect.edu', Role.STUDENT, 'STU-BCOM-001', comm.id);
  await mkUser('Arjun (BSc Physics)', 'arjun.physics@student.campusconnect.edu', Role.STUDENT, 'STU-PHY-001', sci.id);

  // ---- Resources ----
  type ResInput = {
    name: string;
    code: string;
    type: ResourceType;
    departmentId: string;
    building: string;
    roomNumber: string;
    floor: string;
    capacity: number;
    facilities: string;
    start?: string;
    end?: string;
    approval?: boolean;
  };
  const mkRes = (r: ResInput) =>
    prisma.resource.create({
      data: {
        name: r.name,
        code: r.code,
        type: r.type,
        description: r.name,
        departmentId: r.departmentId,
        building: r.building,
        roomNumber: r.roomNumber,
        floor: r.floor,
        capacity: SHARED_TYPES.includes(r.type) ? r.capacity : 60,
        facilities: r.facilities,
        operatingHoursStart: r.start ?? '08:30',
        operatingHoursEnd: r.end ?? '16:30',
        minBookingMinutes: 30,
        maxBookingMinutes: r.approval ? 240 : 180,
        minAdvanceDays: 0,
        maxAdvanceDays: 14,
        requiresApproval: true,
        isActive: true,
        maintenanceStatus: ResourceMaintenanceStatus.OPERATIONAL,
      },
    });

  // Computer Department: programs x 3 years
  const compPrograms = [
    { key: 'BCA', label: 'BCA' },
    { key: 'BSCAI', label: 'BSc AI' },
    { key: 'BSCCS', label: 'BSc Computer Science' },
  ];
  const compClass: Record<string, string> = {};
  let idx = 0;
  for (const p of compPrograms) {
    for (let y = 1; y <= 3; y++) {
      const res = await mkRes({
        name: `${p.label} ${YEAR_LABEL[y - 1]} Year Classroom`,
        code: `CLS-COMP-${p.key}${y}`,
        type: ResourceType.CLASSROOM,
        departmentId: comp.id,
        building: 'Computer Block',
        roomNumber: `C-${101 + Math.floor(idx / 3) * 100 + (idx % 3)}`,
        floor: `${idx < 3 ? '1st' : idx < 6 ? '2nd' : '3rd'} Floor`,
        capacity: 60,
        facilities: 'Projector, Smart Board, WiFi, AC',
      });
      compClass[`${p.key}${y}`] = res.id;
      idx++;
    }
  }
  const labSoft = await mkRes({
    name: 'Software Development & Database Lab',
    code: 'LAB-COMP-105',
    type: ResourceType.COMPUTER_LAB,
    departmentId: comp.id,
    building: 'Computer Block',
    roomNumber: 'C-001',
    floor: 'Ground Floor',
    capacity: 50,
    facilities: '50 Workstations, Projector, Gigabit LAN, AC',
    start: '08:30',
    end: '16:30',
    approval: true,
  });
  await mkRes({
    name: 'AI & Data Science Lab',
    code: 'LAB-COMP-AI1',
    type: ResourceType.COMPUTER_LAB,
    departmentId: comp.id,
    building: 'Computer Block',
    roomNumber: 'C-002',
    floor: 'Ground Floor',
    capacity: 40,
    facilities: '40 GPU Workstations, Projector, AC',
    start: '08:30',
    end: '16:30',
    approval: true,
  });

  // Commerce Department: one classroom per program
  const commPrograms = [
    { key: 'BCOM', label: 'B.Com' },
    { key: 'BCOMFIN', label: 'B.Com Finance' },
    { key: 'BCOMCA', label: 'B.Com CA' },
    { key: 'BCOMCOR', label: 'B.Com Corporate' },
    { key: 'BBA', label: 'BBA' },
    { key: 'BVOC', label: 'B.Voc' },
  ];
  let cr = 101;
  for (const p of commPrograms) {
    await mkRes({
      name: `${p.label} Classroom`,
      code: `CLS-COMM-${p.key}`,
      type: ResourceType.CLASSROOM,
      departmentId: comm.id,
      building: 'Commerce Block',
      roomNumber: `M-${cr}`,
      floor: cr < 200 ? '1st Floor' : '2nd Floor',
      capacity: 70,
      facilities: 'Projector, Whiteboard, WiFi',
    });
    cr++;
  }
  await mkRes({
    name: 'Commerce Computer Lab (Tally & Accounting)',
    code: 'LAB-COMM-001',
    type: ResourceType.COMPUTER_LAB,
    departmentId: comm.id,
    building: 'Commerce Block',
    roomNumber: 'M-001',
    floor: 'Ground Floor',
    capacity: 40,
    facilities: '40 Workstations with Tally, Projector, AC',
    approval: true,
  });

  // Science Department
  const sciPrograms = [
    { key: 'PHY', label: 'BSc Physics' },
    { key: 'CHE', label: 'BSc Chemistry' },
    { key: 'MAT', label: 'BSc Mathematics' },
  ];
  let sr = 101;
  for (const p of sciPrograms) {
    await mkRes({
      name: `${p.label} Classroom`,
      code: `CLS-SCI-${p.key}`,
      type: ResourceType.CLASSROOM,
      departmentId: sci.id,
      building: 'Science Block',
      roomNumber: `S-${sr}`,
      floor: '1st Floor',
      capacity: 60,
      facilities: 'Projector, Whiteboard, WiFi',
    });
    sr++;
  }
  await mkRes({
    name: 'Physics Laboratory',
    code: 'LAB-SCI-PHY',
    type: ResourceType.SCIENCE_LAB,
    departmentId: sci.id,
    building: 'Science Block',
    roomNumber: 'S-001',
    floor: 'Ground Floor',
    capacity: 30,
    facilities: 'Optics & Electronics Benches, Oscilloscopes',
    approval: true,
  });
  await mkRes({
    name: 'Chemistry Laboratory',
    code: 'LAB-SCI-CHE',
    type: ResourceType.SCIENCE_LAB,
    departmentId: sci.id,
    building: 'Science Block',
    roomNumber: 'S-002',
    floor: 'Ground Floor',
    capacity: 30,
    facilities: 'Fume Hoods, Reagent Store, Safety Showers',
    approval: true,
  });

  // Shared
  await mkRes({
    name: 'Main Auditorium',
    code: 'AUD-MAIN-01',
    type: ResourceType.AUDITORIUM,
    departmentId: comp.id,
    building: 'Main Block',
    roomNumber: 'AUD-100',
    floor: 'Ground Floor',
    capacity: 300,
    facilities: 'Projector, Sound System, Stage Lighting, AC',
    start: '00:00',
    end: '23:59',
    approval: true,
  });
  await mkRes({
    name: 'Main Seminar Hall',
    code: 'SEM-MAIN-01',
    type: ResourceType.SEMINAR_HALL,
    departmentId: comp.id,
    building: 'Main Block',
    roomNumber: 'SEM-101',
    floor: '1st Floor',
    capacity: 120,
    facilities: 'Projector, Podium Mic, Sound System, Video Conferencing, AC',
    start: '00:00',
    end: '23:59',
    approval: true,
  });
  await mkRes({
    name: 'College Open Area',
    code: 'OPEN-MAIN-01',
    type: ResourceType.MEETING_ROOM,
    departmentId: comp.id,
    building: 'Campus Ground',
    roomNumber: 'OPEN-01',
    floor: 'Open Area',
    capacity: 1000,
    facilities: 'Open ground, Stage Setup, Portable Sound System, Power Points',
    start: '00:00',
    end: '23:59',
    approval: true,
  });
  await mkRes({
    name: 'Main Conference Room',
    code: 'CONF-MAIN-01',
    type: ResourceType.MEETING_ROOM,
    departmentId: comp.id,
    building: 'Main Block',
    roomNumber: 'CONF-201',
    floor: '2nd Floor',
    capacity: 25,
    facilities: 'Conference Table, Display Screen, Video Conferencing, WiFi, AC',
    start: '00:00',
    end: '23:59',
    approval: true,
  });

  // ---- A few timetable entries ----
  const sched = (
    resourceId: string,
    courseName: string,
    courseCode: string,
    instructorName: string,
    dayOfWeek: DayOfWeek,
    startTime: string,
    endTime: string,
    semester: string
  ) => ({
    resourceId,
    departmentId: comp.id,
    courseName,
    courseCode,
    instructorName,
    dayOfWeek,
    startTime,
    endTime,
    semester,
    academicYear: '2026-2027',
    isActive: true,
  });
  await prisma.academicSchedule.createMany({
    data: [
      sched(compClass['BCA1'], 'BCA 1st Year - C Programming', 'BCA-101', 'Faculty A', DayOfWeek.MONDAY, '09:00', '10:30', 'Year 1'),
      sched(compClass['BCA2'], 'BCA 2nd Year - Data Structures', 'BCA-201', 'Faculty B', DayOfWeek.TUESDAY, '10:30', '12:00', 'Year 2'),
      sched(compClass['BCA3'], 'BCA 3rd Year - Web Development', 'BCA-301', 'Faculty C', DayOfWeek.WEDNESDAY, '13:00', '14:30', 'Year 3'),
      sched(compClass['BSCAI1'], 'BSc AI 1st Year - Python Programming', 'AI-101', 'Faculty D', DayOfWeek.MONDAY, '09:30', '11:00', 'Year 1'),
      sched(compClass['BSCAI2'], 'BSc AI 2nd Year - Machine Learning', 'AI-201', 'Faculty D', DayOfWeek.TUESDAY, '10:30', '12:00', 'Year 2'),
      sched(compClass['BSCAI3'], 'BSc AI 3rd Year - Deep Learning', 'AI-301', 'Faculty E', DayOfWeek.THURSDAY, '14:00', '15:30', 'Year 3'),
      sched(compClass['BSCCS1'], 'BSc CS 1st Year - Programming Fundamentals', 'CS-101', 'Faculty F', DayOfWeek.FRIDAY, '09:00', '10:30', 'Year 1'),
      sched(labSoft.id, 'BCA 2nd Year - DBMS Lab', 'BCA-203L', 'Faculty B', DayOfWeek.THURSDAY, '14:00', '16:30', 'Year 2'),
    ],
  });

  // ---- Equipment ----
  await prisma.equipment.create({
    data: {
      name: 'Portable Projector',
      assetCode: 'EQ-COMP-PRJ-01',
      category: 'Audio-Visual',
      departmentId: comp.id,
      quantityOwned: 6,
      quantityAvailable: 6,
      condition: EquipmentCondition.GOOD,
      location: 'Computer Block Store',
      description: 'HDMI portable projector',
      maintenanceStatus: 'OPERATIONAL',
    },
  });

  console.log('✅ Seeding completed.');
  console.log('Login (all passwords: Password123!)');
  console.log('  admin@campusconnect.edu (Super Admin)');
  console.log('  webadmin@campusconnect.edu (Website Admin)');
  console.log('  coordinator.comp@campusconnect.edu');
  console.log('  coordinator.comm@campusconnect.edu');
  console.log('  coordinator.sci@campusconnect.edu');
  console.log('  rohan.bca@student.campusconnect.edu');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
