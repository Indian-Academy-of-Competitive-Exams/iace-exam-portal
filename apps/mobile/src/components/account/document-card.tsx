/**
 * One uploadable document, picked from the phone. A photo comes from the image
 * library; a marksheet may also be a PDF, so that one goes through the document
 * picker. What is on file opens in whatever the phone reads it with.
 */
/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Alert as NativeAlert, Image, Linking, Pressable, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {
  ACCEPTED_TYPES_FOR,
  DOCUMENT_KINDS,
  DOCUMENT_MAX_BYTES,
  type DocumentKind,
  type Me,
  type UploadFile,
} from '@iace/contracts';
import { Text } from '../ui/text';
import { api } from '../../lib/api';
import { ME_QUERY_KEY, PROFILE_QUERY_KEY } from '../../lib/constants';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

const MEGABYTES = Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024);

/** Which link on the record is each card's. */
const LINK_FOR = {
  [DOCUMENT_KINDS.PHOTO]: 'photoUrl',
  [DOCUMENT_KINDS.TENTH_MARKSHEET]: 'tenthMarksheetUrl',
} as const satisfies Record<DocumentKind, keyof NonNullable<Me['profile']>>;

export function DocumentCard({
  kind,
  label,
  url,
}: Readonly<{ kind: DocumentKind; label: string; url: string | null }>) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);

  const upload = useMutation({
    mutationFn: (file: UploadFile) => api.me.uploadDocument(kind, file),
    onSuccess: (me: Me) => {
      // Shown from the response, then re-read: a second write answering late would put back the record it left with.
      queryClient.setQueryData(PROFILE_QUERY_KEY, me);
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });

  const choose = async () => {
    setPicking(true);
    try {
      const picked = await (kind === DOCUMENT_KINDS.PHOTO ? pickPhoto() : pickFile(kind));
      if (picked) upload.mutate(picked);
    } finally {
      setPicking(false);
    }
  };

  /** The link on screen was signed when the record was read and lasts minutes, so the one opened is read at the tap. */
  const open = async () => {
    // A read that fails is already said by the query client; a link nothing opens is this card's to say.
    const me = await queryClient
      .fetchQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() })
      .catch(() => null);
    const link = me?.profile?.[LINK_FOR[kind]];
    if (!link) return;
    await Linking.openURL(link).catch(() =>
      NativeAlert.alert(`${label} could not be opened on this phone.`),
    );
  };

  return (
    <Card className="flex-1 gap-3 p-4">
      <Preview url={url} label={label} onOpen={() => void open()} />

      <View className="flex-row items-center justify-between gap-2">
        <Text variant="label" className="flex-1" numberOfLines={1}>
          {label}
        </Text>
        <Text className={url ? 'text-xs text-success-ink' : 'text-xs text-muted-foreground'}>
          {url ? 'On file' : 'Not added'}
        </Text>
      </View>

      <Button
        variant="outline"
        size="sm"
        disabled={picking}
        loading={upload.isPending}
        onPress={() => void choose()}
      >
        {/* Named for what it does to what is there: "Upload" over one reads as adding a second. */}
        {url ? 'Replace this' : 'Upload'}
      </Button>

      <Text className="text-2xs text-muted-foreground">{rulesFor(kind)}</Text>
    </Card>
  );
}

function Preview({
  url,
  label,
  onOpen,
}: Readonly<{ url: string | null; label: string; onOpen: () => void }>) {
  if (!url) {
    return (
      <View className="h-32 items-center justify-center rounded-md border border-dashed border-border bg-muted">
        <Text variant="meta">Nothing uploaded</Text>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${label}`}
      onPress={onOpen}
      className="h-32 items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
    >
      {isPdf(url) ? (
        <Text variant="meta">PDF. Tap to open</Text>
      ) : (
        <Image source={{ uri: url }} resizeMode="cover" className="h-full w-full" />
      )}
    </Pressable>
  );
}

/** The library, not the camera: a hall-ticket photo is one they already had taken. */
async function pickPhoto(): Promise<UploadFile | null> {
  // Android's own photo picker shows the Google library; legacy asks the phone's gallery instead.
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    legacy: true,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  return asset ? withinLimit(asset.uri, asset.fileSize) : null;
}

async function pickFile(kind: DocumentKind): Promise<UploadFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: [...ACCEPTED_TYPES_FOR[kind]],
    // Copied into the app's own cache, or the upload reads a URI the picker has already released.
    copyToCacheDirectory: true,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  return asset ? withinLimit(asset.uri, asset.size) : null;
}

/** Refused here rather than after the upload: the server's answer costs them the whole file. */
function withinLimit(uri: string, reported: number | undefined): UploadFile | null {
  const file = new File(uri);
  // Some providers report no size, and the file the upload reads has one.
  if ((reported ?? file.size) <= DOCUMENT_MAX_BYTES) return file;
  NativeAlert.alert(`That file is over ${MEGABYTES}MB. Choose a smaller one.`);
  return null;
}

/** Said before they choose, not after it is refused. */
const rulesFor = (kind: DocumentKind) =>
  `${ACCEPTED_TYPES_FOR[kind]
    .map((type) => type.split('/')[1]?.toUpperCase())
    .join(', ')} · up to ${MEGABYTES}MB`;

/** By extension, with the query dropped first: a signature's characters would eventually match. */
function isPdf(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return path.toLowerCase().endsWith('.pdf');
}
