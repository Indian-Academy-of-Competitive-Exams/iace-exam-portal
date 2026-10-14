import {
  AppException,
  ErrorCodes,
  STUDENT_TYPE,
  type ExamCourse,
  type Gender,
  type StudentDetail,
  type UpdateStudentBody,
  type UpdateStudentInput,
  type StudentType,
} from '@iace/contracts';
import { changedValues } from '@iace/app-kit';
import type { UseFormReturn } from 'react-hook-form';

export interface FormValues {
  fullName: string;
  studentType: StudentType;
  enrolledExams: string[];
  enrolledCourses: ExamCourse[];
  programs: string[];
  currentBranchId: string;
  motherName: string;
  fatherName: string;
  dob: string;
  email: string;
  address: string;
  gender: '' | Gender;
}

export const FORM_FIELDS = [
  'fullName',
  'studentType',
  'enrolledExams',
  'enrolledCourses',
  'programs',
  'currentBranchId',
  'motherName',
  'fatherName',
  'dob',
  'email',
  'address',
  'gender',
] as const;
export type FormFieldName = (typeof FORM_FIELDS)[number];

/** One name per field, for its label and for the alert that says it moved. */
export const FIELD_LABELS: Record<FormFieldName, string> = {
  fullName: 'Full name',
  studentType: 'Student type',
  enrolledExams: 'Enrolled exams',
  enrolledCourses: 'Enrolled courses',
  programs: 'Programs',
  currentBranchId: 'Current branch',
  motherName: "Mother's name",
  fatherName: "Father's name",
  dob: 'Date of birth',
  email: 'Email',
  address: 'Address',
  gender: 'Gender',
};

const PROFILE_TEXT_FIELDS = ['motherName', 'fatherName', 'dob', 'email', 'address'] as const;

/** An empty input means "no value", which the API expresses as null. */
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

// Access fields are sent only when a save moves one; an online student's type always rides along, as saying it is what puts them in the online branch.
function accessPatch(
  values: FormValues,
  dirty: { studentType?: boolean; currentBranchId?: boolean },
): Pick<UpdateStudentBody, 'studentType' | 'currentBranchId'> {
  const online = values.studentType === STUDENT_TYPE.ONLINE;
  const branchPatch = () => {
    if (values.studentType === STUDENT_TYPE.NON_IACE) return { currentBranchId: null };
    if (!online && dirty.currentBranchId) {
      return { currentBranchId: orNull(values.currentBranchId) };
    }
    return {};
  };

  return {
    ...(dirty.studentType || online ? { studentType: values.studentType } : {}),
    ...branchPatch(),
  };
}

/** What a save sends: a field left as it opened is omitted, so it cannot put back a value saved since. */
export function patchOf(form: UseFormReturn<FormValues>): UpdateStudentInput {
  const changed = changedValues(form);
  const profile: NonNullable<UpdateStudentInput['profile']> = {};
  for (const field of PROFILE_TEXT_FIELDS) {
    const value = changed[field];
    if (value !== undefined) profile[field] = orNull(value);
  }
  if (changed.gender !== undefined) profile.gender = changed.gender || null;

  return {
    ...(changed.fullName === undefined ? {} : { fullName: orNull(changed.fullName) }),
    ...accessPatch(form.getValues(), form.formState.dirtyFields),
    ...(changed.enrolledExams ? { enrolledExams: changed.enrolledExams } : {}),
    ...(changed.enrolledCourses ? { enrolledCourses: changed.enrolledCourses } : {}),
    ...(changed.programs ? { programs: changed.programs } : {}),
    ...(Object.keys(profile).length > 0 ? { profile } : {}),
  };
}

/** The fields a save writes that were written elsewhere since its edit began; none while no edit is open. */
export function movedSince(
  patch: UpdateStudentInput,
  opened: StudentDetail | null,
  latest: StudentDetail | undefined,
): FormFieldName[] {
  if (!opened || !latest) return [];
  const [before, now] = [toFormValues(opened), toFormValues(latest)];
  const sent = new Set([...Object.keys(patch), ...Object.keys(patch.profile ?? {})]);
  return FORM_FIELDS.filter(
    (field) => sent.has(field) && JSON.stringify(before[field]) !== JSON.stringify(now[field]),
  );
}

export const isStale = (error: unknown) =>
  AppException.is(error) && error.code === ErrorCodes.CONFLICT;

export function toFormValues(student: StudentDetail): FormValues {
  return {
    fullName: student.fullName ?? '',
    studentType: student.studentType,
    enrolledExams: [...student.enrolledExams],
    enrolledCourses: [...student.enrolledCourses],
    programs: [...student.programs],
    currentBranchId: student.currentBranchId ?? '',
    motherName: student.profile?.motherName ?? '',
    fatherName: student.profile?.fatherName ?? '',
    dob: student.profile?.dob ?? '',
    email: student.profile?.email ?? '',
    address: student.profile?.address ?? '',
    gender: student.profile?.gender ?? '',
  };
}
