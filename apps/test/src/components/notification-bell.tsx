import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger, plural } from '@iace/ui';
import { api } from '../lib/api';
import { ROUTES, UNREAD_POLL_MS, UNREAD_QUERY_KEY } from '../lib/constants';

/** Past this the count stops being a number and becomes "a lot", which is all it has to say. */
const MAX_SHOWN = 9;

/** One row is asked for because the answer wanted is `meta.total`, not the rows. */
export function NotificationBell() {
  const unread = useQuery({
    queryKey: UNREAD_QUERY_KEY,
    queryFn: () => api.me.notifications({ unreadOnly: 'true', page: 1, pageSize: 1 }),
    refetchInterval: UNREAD_POLL_MS,
  });

  const count = unread.data?.total ?? 0;
  const label = count > 0 ? `Notifications, ${plural(count, 'unread')}` : 'Notifications';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" asChild>
          <Link to={ROUTES.NOTIFICATIONS} aria-label={label}>
            <span className="relative">
              <Bell aria-hidden />
              {count > 0 ? (
                <span
                  aria-hidden
                  className="bg-primary text-primary-foreground absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.625rem] leading-none font-medium"
                >
                  {count > MAX_SHOWN ? `${MAX_SHOWN}+` : count}
                </span>
              ) : null}
            </span>
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
