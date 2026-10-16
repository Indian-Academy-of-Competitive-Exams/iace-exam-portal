import { Alert as NativeAlert } from 'react-native';
import { File } from 'expo-file-system';
import { type UploadFile } from '@iace/contracts';

export const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024);

/** Refused here rather than after the upload: the server's answer costs them the whole file. */
export function withinLimit(
  uri: string,
  reported: number | undefined,
  maxBytes: number,
): UploadFile | null {
  const file = new File(uri);
  // Some providers report no size, and the file the upload reads has one.
  if ((reported ?? file.size) <= maxBytes) return file;
  NativeAlert.alert(`That file is over ${megabytes(maxBytes)}MB. Choose a smaller one.`);
  return null;
}
