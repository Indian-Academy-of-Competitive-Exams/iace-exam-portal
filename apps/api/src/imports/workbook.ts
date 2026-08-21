import ExcelJS from 'exceljs';
import { STUDENT_IMPORT_COLUMNS } from '@iace/contracts';

/** The sample file the UI offers. */
export function buildStudentTemplate(): Promise<Buffer> {
  return buildTemplate({
    sheetName: 'Students',
    columns: STUDENT_IMPORT_COLUMNS,
    examples: STUDENT_IMPORT_EXAMPLES,
    notes: STUDENT_IMPORT_NOTES,
  });
}

async function buildTemplate(options: {
  sheetName: string;
  columns: readonly { key: string; header: string; width: number }[];
  examples: unknown[][];
  notes: string[][];
}): Promise<Buffer> {
  const { sheetName, columns, examples, notes: noteLines } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IACE';
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  });

  for (const example of examples) sheet.addRow(example);

  // Mobile numbers are text, not numbers: left as numeric, Excel drops a leading zero and shows long
  // ones in exponent form, and the file that comes back is full of "9.87654E+09".
  sheet.getColumn(1).numFmt = '@';

  const notes = workbook.addWorksheet('How to use');
  notes.getColumn(1).width = 100;
  for (const line of noteLines) notes.addRow(line);
  notes.getRow(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Column order must match STUDENT_IMPORT_COLUMNS.
const STUDENT_IMPORT_EXAMPLES = [
  [
    '9876543210',
    'Asha Kumari',
    'OFFLINE',
    'AMEERPET',
    'SSC',
    'SSC CGL, SSC CHSL',
    'SSC FOUNDATION',
    'Lakshmi Kumari',
    'Ravi Kumar',
    '2003-04-11',
    'asha@example.com',
    'FEMALE',
    'Ameerpet, Hyderabad',
  ],
  ['9876543211', 'Ravi Teja', 'ONLINE', 'ONLINE', '', 'RRB JE', '', '', '', '', '', '', ''],
  ['9876543212', '', 'OFFLINE', 'KUKATPALLY', 'BANKING', '', '', '', '', '', '', '', ''],
];

const STUDENT_IMPORT_NOTES = [
  ['How to fill this in'],
  [''],
  ['Mobile Number — required. 10 digits. This is what identifies a student: if the'],
  ['number already exists, that student is updated rather than duplicated.'],
  [''],
  ['Each new student is given a starting PIN: the FIRST FOUR DIGITS of their own'],
  ['mobile number. Tell them to change it when they first sign in — anyone holding'],
  ['this sheet can work it out. A student who has already chosen a PIN keeps it.'],
  [''],
  ['Full Name — optional. Letters, spaces and . ’ - only. Leave it blank if you'],
  ['do not know it yet; it can be filled in later.'],
  [''],
  ['Student Type — required. ONLINE, OFFLINE or NON-IACE.'],
  [''],
  ['Branch Name — required. The centre’s NAME as it appears on the Branches screen,'],
  ['not an id. Case and extra spaces do not matter. An ONLINE student belongs to the'],
  ['ONLINE branch; an OFFLINE student belongs to a physical centre.'],
  [''],
  ['WHAT A STUDENT CAN REACH'],
  [''],
  ['Enrolled Families, Enrolled Exams and Programs decide which test series a student'],
  ['can open. Every row needs AT LEAST ONE of the three — a row with none creates a'],
  ['student who can open nothing, and is reported rather than imported.'],
  [''],
  ['Separate several values with commas: "SSC CGL, SSC CHSL". Semicolons and slashes'],
  ['work too. Exam and program codes must already exist in the catalog.'],
  [''],
  ['Enrolled Families — a whole family (SSC, RRB, BANKING, AP/TS POLICE), for a student'],
  ['coached across every exam in it rather than one.'],
  [''],
  ['THE REST ARE OPTIONAL'],
  [''],
  ['Mother’s Name, Father’s Name and Date of Birth are the three a student needs before'],
  ['they can sit a test. Filling them here saves asking for them later.'],
  [''],
  ['Date of Birth — 2003-04-11, or 11/04/2003. Gender — MALE, FEMALE or OTHER.'],
  [''],
  ['Nothing is written until you press Import. The preview shows exactly what would'],
  ['happen to every row, and rows with errors are skipped rather than stopping the file.'],
];
