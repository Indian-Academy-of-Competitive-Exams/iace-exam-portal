import { ERROR_CODE_STATUS, type ErrorCodes } from '@iace/contracts';

export const fetchMock = jest.mocked(globalThis.fetch);

const META = { requestId: 'screen-test' };

// A fresh Response each time: a body is read once.
function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const ok = (data: unknown) => answer(200, { success: true, data, meta: META });

export const refused = (
  code: keyof typeof ErrorCodes,
  message: string,
  fieldErrors?: Record<string, string[]>,
) =>
  answer(ERROR_CODE_STATUS[code], {
    success: false,
    error: { code, message, fieldErrors },
    meta: META,
  });

const pathOf = (input: unknown) => new URL(String(input)).pathname;

/** Answers each request by its path; a request to any other is a failed test. */
export function serve(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (input) => {
    const respond = routes[pathOf(input)];
    if (!respond) throw new Error(`No answer for ${pathOf(input)}`);
    return respond();
  });
}

/** The bodies sent to one path, parsed. */
export const sentTo = (route: string): unknown[] =>
  fetchMock.mock.calls
    .filter(([input]) => pathOf(input) === route)
    .map(([, init]) => JSON.parse(String(init?.body)));
