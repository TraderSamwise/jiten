import React, { useRef, useState } from "react";
import { View, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useSignIn } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function handleSignIn() {
    if (!isLoaded) return;
    setError("");
    setLoading(true);
    try {
      const result = await signIn.create({
        identifier: email,
        password,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
      }
    } catch (err: any) {
      setError(err.errors?.[0]?.longMessage ?? "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1 justify-center px-8">
        <Text className="text-3xl font-bold text-foreground text-center mb-8">Jiten</Text>

        <TextInput
          className="h-12 rounded-lg border border-border bg-background px-4 text-foreground mb-3"
          placeholder="Email"
          placeholderTextColor="#9ca3af"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
        />

        <TextInput
          ref={passwordRef}
          className="h-12 rounded-lg border border-border bg-background px-4 text-foreground mb-3"
          placeholder="Password"
          placeholderTextColor="#9ca3af"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={handleSignIn}
        />

        {error ? <Text className="text-red-500 text-sm mb-3">{error}</Text> : null}

        <Button
          label={loading ? "Signing in..." : "Sign In"}
          onPress={handleSignIn}
          disabled={loading}
        />

        <Button
          className="mt-3"
          variant="ghost"
          label="Don't have an account? Sign Up"
          onPress={() => router.push("/sign-up")}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
