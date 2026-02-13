export async function saveAndShareFile(
  filename: string,
  content: string,
  mimeType: string,
): Promise<void> {
  const FileSystem = require("expo-file-system/legacy");
  const Sharing = require("expo-sharing");

  const fileUri = FileSystem.cacheDirectory + filename;
  await FileSystem.writeAsStringAsync(fileUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await Sharing.shareAsync(fileUri, {
    mimeType,
    UTI: "public.json",
  });
}
