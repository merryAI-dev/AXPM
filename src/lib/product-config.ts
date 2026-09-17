import { z } from "zod";

const id = z.string().trim().regex(/^[\w-]{10,}$/);
const schema = z.object({
  programName: z.string().trim().min(1),
  masterSpreadsheetId: id,
  masterSheetId: z.coerce.number().int().nonnegative(),
  masterSheetTitle: z.string().trim().min(1),
  masterDashboardRange: z.string().trim().regex(/^[A-Z]+\d+:[A-Z]+\d+$/),
  driveRootId: id,
  reportFolderId: id,
  defaultCampus: z.string().trim().min(1),
  gmailQuery: z
    .string()
    .trim()
    .min(1)
    .default("label:AXPM/첨부수집 has:attachment newer_than:30d"),
});

export const productConfig = () =>
  schema.parse({
    programName: process.env.AXPM_PROGRAM_NAME,
    masterSpreadsheetId: process.env.AXPM_MASTER_SPREADSHEET_ID,
    masterSheetId: process.env.AXPM_MASTER_SHEET_ID,
    masterSheetTitle: process.env.AXPM_MASTER_SHEET_TITLE,
    masterDashboardRange: process.env.AXPM_MASTER_DASHBOARD_RANGE,
    driveRootId: process.env.AXPM_DRIVE_ROOT_ID,
    reportFolderId: process.env.AXPM_REPORT_FOLDER_ID,
    defaultCampus: process.env.AXPM_DEFAULT_CAMPUS,
    gmailQuery: process.env.AXPM_GMAIL_QUERY,
  });

export function publicProductConfig() {
  const config = productConfig();
  return {
    programName: config.programName,
    defaultCampus: config.defaultCampus,
    masterSheetTitle: config.masterSheetTitle,
    masterUrl: `https://docs.google.com/spreadsheets/d/${config.masterSpreadsheetId}/edit#gid=${config.masterSheetId}`,
    reportFolderId: config.reportFolderId,
  };
}
