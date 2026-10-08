import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  STUDENT_TYPE,
  type AuthTokens,
  type StudentDetail,
  type UpdateStudentInput,
} from '@iace/contracts';
import { TooltipProvider } from '@iace/ui';
import { TourProvider } from '@iace/app-kit/browser';
import './support/offline';
import { api, tokenStore } from '../src/lib/api';
import { AuthProvider } from '../src/providers/auth';
import { StudentDetailPage } from '../src/features/students/student-detail';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({
  defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
});

afterEach(() => {
  cleanup();
  client.clear();
  tokenStore.clear();
  mock.restoreAll();
});

const OPENED_AT = '2026-10-01T04:00:00.000Z';
const MOVED_AT = '2026-10-01T04:05:00.000Z';
const TYPED_EMAIL = 'asha@example.com';
const SAVE = 'Save changes';

const STUDENT: StudentDetail = {
  id: 'stu_1',
  mobile: '9876543210',
  fullName: 'Asha',
  studentType: STUDENT_TYPE.OFFLINE,
  enrolledExams: [],
  enrolledCourses: [],
  programs: [],
  hasOwnAccess: false,
  isActive: true,
  isTestBlocked: false,
  preTestReady: true,
  profileCompleted: true,
  createdAt: OPENED_AT,
  events: [],
  formerMobiles: [],
  currentBranchId: null,
  updatedAt: OPENED_AT,
  profile: {
    motherName: 'Lakshmi',
    fatherName: 'Ravi',
    dob: '2004-05-01',
    email: null,
    address: null,
    gender: null,
    photoUrl: null,
    aadhaarVerified: false,
    panVerified: false,
    tenthMarksheetUrl: null,
    educationDetails: null,
    pastExamHistory: null,
  },
};

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
};

/** The student's page for a super admin, reading the student as opened and then, on any re-read, `later`. */
function open(later: StudentDetail = STUDENT) {
  tokenStore.set({ accessToken: 'access', refreshToken: 'refresh' } as AuthTokens);
  mock.method(api.auth, 'me', () =>
    Promise.resolve({
      actor: ActorTypes.ADMIN,
      id: 'admin_1',
      email: 'ops@iace.co.in',
      fullName: null,
      isActive: true,
      isSuperAdmin: true,
      permissions: {},
    }),
  );
  let reads = 0;
  mock.method(api.admin.students, 'detail', () => Promise.resolve(reads++ === 0 ? STUDENT : later));

  render(
    <MemoryRouter initialEntries={[`/students/${STUDENT.id}`]}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TooltipProvider>
            <TourProvider storage={storage} storageKey="tours">
              <Routes>
                <Route path="/students/:id" element={<StudentDetailPage />} />
              </Routes>
            </TourProvider>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Answers each save in turn; a stamp the record has moved past is refused as the server refuses it. */
function serverAt(stamp: string) {
  return mock.method(api.admin.students, 'update', (_id: string, body: UpdateStudentInput) =>
    body.expectedUpdatedAt === stamp
      ? Promise.resolve({ ...STUDENT, updatedAt: MOVED_AT })
      : Promise.reject(new AppException(ErrorCodes.CONFLICT, 'These details changed')),
  );
}

const bodies = (update: ReturnType<typeof serverAt>) =>
  update.mock.calls.map((call) => call.arguments[1]);

async function typeAnEmailAndSave() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: TYPED_EMAIL } });
  fireEvent.click(screen.getByRole('button', { name: SAVE }));
}

describe('an admin’s save of a student’s details', () => {
  /** The failure this prevents: every field posted, so a stale page put back a name somebody had corrected. */
  it('sends only the field that was changed, on the stamp the page read', async () => {
    const update = serverAt(OPENED_AT);
    open();

    await typeAnEmailAndSave();

    await waitFor(() => assert.equal(update.mock.callCount(), 1));
    assert.deepEqual(bodies(update), [
      { profile: { email: TYPED_EMAIL }, expectedUpdatedAt: OPENED_AT },
    ]);
  });

  /** A rename, a block or the student's own save moves the stamp, and none of them is this admin's field. */
  it('refused as out of date, reads the record again and lands when another field is what moved', async () => {
    const update = serverAt(MOVED_AT);
    open({ ...STUDENT, fullName: 'Asha Rani', updatedAt: MOVED_AT });

    await typeAnEmailAndSave();

    await waitFor(() => assert.equal(update.mock.callCount(), 2));
    assert.deepEqual(bodies(update).at(-1), {
      profile: { email: TYPED_EMAIL },
      expectedUpdatedAt: MOVED_AT,
    });
  });

  /** The failure this prevents: the second of two edits to one field winning without a word. */
  it('is not sent again when the field it writes is the one that moved, and says which', async () => {
    const update = serverAt(MOVED_AT);
    const elsewhere = {
      ...STUDENT.profile,
      email: 'asha.rani@example.com',
    } as StudentDetail['profile'];
    open({ ...STUDENT, profile: elsewhere, updatedAt: MOVED_AT });

    await typeAnEmailAndSave();

    assert.ok(await screen.findByText(/Changed elsewhere since you began editing: Email\./));
    assert.equal(update.mock.callCount(), 1);
    assert.equal((screen.getByRole('button', { name: SAVE }) as HTMLButtonElement).disabled, true);
  });
});
