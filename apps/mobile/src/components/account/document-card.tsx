/**
 * One uploadable document, picked from the phone. A photo comes from the image
 * library; a marksheet may also be a PDF, so that one goes through the document
 * picker. What is on file opens in whatever the phone reads it with.
 */
/// <reference types="nativewind/types" />
import { Alert as NativeAlert, Image, Linking, Pressable, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
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

export function DocumentCard({
  kind,
  label,
  url,
}: Readonly<{ kind: DocumentKind; label: string; url: string | null }>) {
  const queryClient = useQueryClient();

  const upload = useMutation({
    mutationFn: (file: UploadFile) => api.me.uploadDocument(kind, file),
    onSuccess: (me: Me) => {
      // The response IS the refreshed profile, so no second request is needed.
      queryClient.setQueryData(PROFILE_QUERY_KEY, me);
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });

  const choose = async () => {
    const picked = await (kind === DOCUMENT_KINDS.PHOTO ? pickPhoto() : pickFile(kind));
    if (picked) upload.mutate(picked);
  };

  return (
    <Card className="flex-1 gap-3 p-4">
      <Preview url={url} label={label} />

      <View className="flex-row items-center justify-between gap-2">
        <Text variant="label" className="flex-1" numberOfLines={1}>
          {label}
        </Text>
        <Text className={url ? 'text-xs text-success-ink' : 'text-xs text-muted-foreground'}>
          {url ? 'On file' : 'Not added'}
        </Text>
      </View>

      <Button variant="outline" size="sm" loading={upload.isPending} onPress={() => void choose()}>
        {/* Named for what it does to what is there: "Upload" over one reads as adding a second. */}
        {url ? 'Replace this' : 'Upload'}
      </Button>

      <Text className="text-2xs text-muted-foreground">{rulesFor(kind)}</Text>
    </Card>
  );
}

function Preview({ url, label }: Readonly<{ url: string | null; label: string }>) {
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
      onPress={() => void Linking.openURL(url)}
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
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    NativeAlert.alert('IACE cannot open your photos until you allow it in Settings.');
    return null;
  }

  // Android's own photo picker shows the Google library; legacy asks the phone's gallery instead.
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    legacy: true,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return null;
  if (tooBig(asset.fileSize)) return null;

  return {
    uri: asset.uri,
    name: asset.fileName ?? 'photo.jpg',
    type: asset.mimeType ?? 'image/jpeg',
  };
}

async function pickFile(kind: DocumentKind): Promise<UploadFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: [...ACCEPTED_TYPES_FOR[kind]],
    // Copied into the app's own cache, or the upload reads a URI the picker has already released.
    copyToCacheDirectory: true,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return null;
  if (tooBig(asset.size)) return null;

  return {
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType ?? 'application/octet-stream',
  };
}

/** Refused here rather than after the upload: the server's answer costs them the whole file. */
function tooBig(size: number | null | undefined): boolean {
  if (typeof size !== 'number' || size <= DOCUMENT_MAX_BYTES) return false;
  NativeAlert.alert(`That file is over ${MEGABYTES}MB. Choose a smaller one.`);
  return true;
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
