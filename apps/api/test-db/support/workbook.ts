import ExcelJS from 'exceljs';

/** The first sheet of an export, one object per data row keyed by its header. */
export async function sheetRows(
  file: Buffer | ArrayBuffer,
): Promise<Record<string, ExcelJS.CellValue>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  const headers = (sheet?.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(String);
  const rows: Record<string, ExcelJS.CellValue>[] = [];
  sheet?.eachRow((row, at) => {
    if (at === 1) return;
    const values = row.values as ExcelJS.CellValue[];
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index + 1]])));
  });
  return rows;
}
