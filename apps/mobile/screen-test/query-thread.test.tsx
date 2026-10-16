import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { SUPPORT_ROUTES, type TicketDetail } from '@iace/contracts';
import QueryThreadScreen from '../app/help/[id]';
import { fetchMock, ok, refused, serve } from './support/network';
import { renderRoutes } from './support/render';

const TICKET: TicketDetail = {
  id: '6f1c2b0e-8a43-4c1d-9d2e-3b5a7c9e1f21',
  title: null,
  category: 'OTHER',
  status: 'ANSWERED',
  lastMessageAt: '2026-10-16T05:00:00.000Z',
  createdAt: '2026-10-16T04:00:00.000Z',
  attemptId: null,
  messages: [],
};

const detailCalls = () =>
  fetchMock.mock.calls.filter(
    ([input]) => new URL(String(input)).pathname === SUPPORT_ROUTES.detail(TICKET.id),
  ).length;

test('a reply refused as closed refetches the query and keeps the words', async () => {
  let status: TicketDetail['status'] = 'ANSWERED';
  fetchMock.mockReset();
  serve({
    [SUPPORT_ROUTES.detail(TICKET.id)]: () => ok({ ...TICKET, status }),
    [SUPPORT_ROUTES.reply(TICKET.id)]: () => {
      status = 'CLOSED';
      return refused('TICKET_CLOSED', 'This query is closed');
    },
  });
  await renderRoutes({ 'help/[id]': QueryThreadScreen }, `/help/${TICKET.id}`);

  await fireEvent.changeText(await screen.findByLabelText('Reply'), 'Still stuck');
  await fireEvent.press(screen.getByText('Send'));

  await waitFor(() => expect(detailCalls()).toBe(2));
  expect(await screen.findByText('Closed')).toBeOnTheScreen();
  expect(screen.getByLabelText('Reply').props.value).toBe('Still stuck');
});
