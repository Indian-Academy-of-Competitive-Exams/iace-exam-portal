/// <reference types="nativewind/types" />
import { useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import ImagePlus from 'lucide-react-native/icons/image-plus';
import Lock from 'lucide-react-native/icons/lock';
import Send from 'lucide-react-native/icons/send';
import X from 'lucide-react-native/icons/x';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppException,
  ErrorCodes,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_BODY_MAX,
  SUPPORT_CATEGORY_INFO,
  SUPPORT_STATUSES,
  instituteDateTimeLabel,
  type SupportAttachment,
  type SupportMessage,
  type TicketDetail,
  type UploadFile,
} from '@iace/contracts';
import { bannerMessage } from '@iace/app-kit';
import { Text } from '../../src/components/ui/text';
import { api } from '../../src/lib/api';
import { cn } from '../../src/lib/cn';
import {
  SUPPORT_QUERY_KEY,
  SUPPORT_STATUS_BADGE,
  SUPPORT_STATUS_LABEL,
  supportTicketQueryKey,
} from '../../src/lib/constants';
import { ACCOUNT_ROUTES } from '../../src/lib/nav';
import { useTokenColor } from '../../src/lib/use-token-color';
import { withinLimit } from '../../src/lib/within-limit';
import { Alert } from '../../src/components/ui/alert';
import { Badge } from '../../src/components/ui/badge';
import { Button } from '../../src/components/ui/button';
import { ConfirmDialog } from '../../src/components/ui/confirm-dialog';
import { EmptyState } from '../../src/components/ui/empty-state';
import { EMPTY_STATE_KINDS } from '../../src/components/ui/empty-state-kinds';
import { Skeleton } from '../../src/components/ui/skeleton';

const STAFF_NAME = 'IACE';
const OWN_NAME = 'You';
const QUERY_TITLE = 'Query';

export default function QueryThreadScreen() {
  const { id: ticketId = '' } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [closing, setClosing] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const detail = useQuery({
    queryKey: supportTicketQueryKey(ticketId),
    queryFn: () => api.me.support.detail(ticketId),
  });
  const ticket = detail.data;

  const settle = (fresh: TicketDetail) => {
    queryClient.setQueryData(supportTicketQueryKey(ticketId), fresh);
    return queryClient.invalidateQueries({ queryKey: SUPPORT_QUERY_KEY });
  };

  const close = useMutation({
    mutationFn: () => api.me.support.close(ticketId),
    onSuccess: async (fresh) => {
      setClosing(false);
      await settle(fresh);
    },
  });

  const closed = ticket?.status === SUPPORT_STATUSES.CLOSED;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
    >
      <Stack.Screen
        options={{
          title: ticket ? SUPPORT_CATEGORY_INFO[ticket.category].label : QUERY_TITLE,
          headerRight: ticket && !closed ? closeAction(() => setClosing(true)) : undefined,
        }}
      />
      <ScrollView
        ref={scroller}
        contentContainerClassName="gap-3 px-5 py-4"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
      >
        {ticket ? (
          <Badge variant={SUPPORT_STATUS_BADGE[ticket.status]}>
            {SUPPORT_STATUS_LABEL[ticket.status]}
          </Badge>
        ) : null}
        <Thread
          ticket={ticket}
          isPending={detail.isPending}
          onRetry={() => void detail.refetch()}
        />
      </ScrollView>

      {ticket ? <Footer ticket={ticket} onSent={settle} /> : null}

      <ConfirmDialog
        open={closing}
        // ui-copy-ok: consequence — a confirm names what it is about to do
        title="Close this query?"
        description="You can no longer reply to it. Anything further needs a new query."
        confirmLabel="Close query"
        icon={Lock}
        destructive
        loading={close.isPending}
        onConfirm={() => close.mutate()}
        onCancel={() => setClosing(false)}
      />
    </KeyboardAvoidingView>
  );
}

/** A header action is a render function the navigator calls, so it is built outside the screen. */
const closeAction = (onPress: () => void) => () => (
  <Button variant="ghost" size="sm" icon={Lock} onPress={onPress}>
    Close query
  </Button>
);

function Thread({
  ticket,
  isPending,
  onRetry,
}: Readonly<{ ticket: TicketDetail | undefined; isPending: boolean; onRetry: () => void }>) {
  if (isPending) {
    return (
      <View className="gap-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </View>
    );
  }
  if (!ticket) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this query"
        onRetry={onRetry}
      />
    );
  }
  return ticket.messages.map((message) => <Message key={message.id} message={message} />);
}

function Message({ message }: Readonly<{ message: SupportMessage }>) {
  const mine = !message.fromStaff;
  return (
    <View
      className={cn(
        'max-w-[85%] gap-1.5 rounded-xl border px-3.5 py-2.5',
        mine
          ? 'self-end border-primary-subtle bg-primary-subtle'
          : 'self-start border-border bg-surface',
      )}
    >
      <Text variant="metaStrong">
        {mine ? OWN_NAME : STAFF_NAME} · {instituteDateTimeLabel(message.createdAt)}
      </Text>
      <Text variant="body">{message.body}</Text>
      {message.attachmentUrl ? (
        <Image
          source={{ uri: message.attachmentUrl }}
          resizeMode="cover"
          accessibilityLabel="Attached picture"
          className="h-48 w-56 rounded-md"
        />
      ) : null}
    </View>
  );
}

function ClosedAlert() {
  const router = useRouter();
  return (
    <Alert
      action={
        <Button
          variant="outline"
          size="sm"
          onPress={() => router.navigate(ACCOUNT_ROUTES.HELP_NEW)}
        >
          Raise a new query
        </Button>
      }
    >
      This query is closed.
    </Alert>
  );
}

function Footer({
  ticket,
  onSent,
}: Readonly<{ ticket: TicketDetail; onSent: (fresh: TicketDetail) => Promise<unknown> }>) {
  if (ticket.status === SUPPORT_STATUSES.CLOSED) {
    return (
      <View className="border-t border-border bg-surface px-5 py-3">
        <ClosedAlert />
      </View>
    );
  }
  return <Composer ticketId={ticket.id} onSent={onSent} />;
}

/** One optional picture a message: the server takes a single attachment key, and needs words with it. */
function Composer({
  ticketId,
  onSent,
}: Readonly<{ ticketId: string; onSent: (fresh: TicketDetail) => Promise<unknown> }>) {
  const [body, setBody] = useState('');
  const [image, setImage] = useState<SupportAttachment | null>(null);
  const [picking, setPicking] = useState(false);
  const ink = useTokenColor('--muted-foreground');
  const placeholder = useTokenColor('--placeholder');

  const upload = useMutation({
    mutationFn: (file: UploadFile) => api.me.support.upload(ticketId, file),
    onSuccess: setImage,
  });

  const send = useMutation({
    // Silent: the alert above the box says it, so a native alert would say it twice.
    meta: { silent: true },
    mutationFn: () => api.me.support.reply(ticketId, { body, attachmentKey: image?.key }),
    onSuccess: async (fresh) => {
      setBody('');
      setImage(null);
      await onSent(fresh);
    },
  });

  const pick = async () => {
    setPicking(true);
    try {
      // Android's own photo picker shows the Google library; legacy asks the phone's gallery instead.
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        legacy: true,
      });
      const asset = picked.canceled ? undefined : picked.assets[0];
      const file = asset
        ? withinLimit(asset.uri, asset.fileSize, SUPPORT_ATTACHMENT_MAX_BYTES)
        : null;
      if (file) upload.mutate(file);
    } finally {
      setPicking(false);
    }
  };

  // The words stay in the box, so a student whose query closed meanwhile can carry them over.
  const refusedClosed = AppException.is(send.error) && send.error.code === ErrorCodes.TICKET_CLOSED;
  const failure = send.isError && !refusedClosed ? bannerMessage(send.error) : null;
  const busy = send.isPending || upload.isPending;

  return (
    <View className="gap-3 border-t border-border bg-surface px-5 py-3">
      {refusedClosed ? <ClosedAlert /> : null}
      {failure ? <Alert variant="danger">{failure}</Alert> : null}

      {image ? (
        <View className="flex-row items-center gap-2">
          <Image source={{ uri: image.url }} resizeMode="cover" className="h-16 w-16 rounded-md" />
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            disabled={send.isPending}
            onPress={() => setImage(null)}
          >
            Remove picture
          </Button>
        </View>
      ) : null}

      <View className="flex-row items-end gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach a picture"
          disabled={refusedClosed || busy || picking}
          onPress={() => void pick()}
          className="h-11 w-11 items-center justify-center rounded-full"
        >
          <ImagePlus size={20} color={ink} />
        </Pressable>
        <TextInput
          value={body}
          onChangeText={setBody}
          editable={!refusedClosed}
          multiline
          maxLength={SUPPORT_BODY_MAX}
          placeholder="Write a reply"
          placeholderTextColor={placeholder}
          accessibilityLabel="Reply"
          className="max-h-32 min-h-11 flex-1 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground"
        />
        <Button
          icon={Send}
          loading={send.isPending}
          disabled={refusedClosed || upload.isPending || body.trim() === ''}
          onPress={() => send.mutate()}
        >
          Send
        </Button>
      </View>
    </View>
  );
}
