import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "last_signed_in_user";

export async function getLastUser(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function setLastUser(userId: string): Promise<void> {
  await AsyncStorage.setItem(KEY, userId);
}
