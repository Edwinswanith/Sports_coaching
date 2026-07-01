import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import { dashboardPathForRole } from "../lib/roles";
import { ROLE_THEMES, colors } from "../lib/theme";
import { Banner, Card, H1, Label, Muted, PrimaryButton, TextField } from "../components/ui";

const theme = ROLE_THEMES.athlete;

export default function Register() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sport, setSport] = useState("");
  const [position, setPosition] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim() || !email.trim() || !sport.trim()) {
      setError("Name, email and sport are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    const result = await signUp({ name: name.trim(), email: email.trim(), password, sport: sport.trim(), position: position.trim() || undefined });
    setSaving(false);
    if (!result.ok) {
      if (result.status === 409) setError("That email already has an account.");
      else if (result.error === "weak_password") setError("Password must be at least 8 characters.");
      else if (result.status === 429) setError("Too many attempts. Wait a minute and try again.");
      else if (result.status === 0) setError("Unable to reach the server. Check your connection.");
      else setError("Couldn't create your account. Check the details and try again.");
      return;
    }
    const dest = dashboardPathForRole(result.user.role) ?? "/athlete/dashboard";
    router.replace(dest as never);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
            <Ionicons name="arrow-back" size={18} color={colors.inkFaint} />
            <Text style={styles.backText}>BACK</Text>
          </Pressable>

          <H1>Create your account</H1>
          <Muted style={{ marginTop: 8, marginBottom: 20 }}>Join as an athlete and start logging in under a minute.</Muted>

          <Card style={{ gap: 14 }}>
            <Field label="Full name" value={name} onChange={setName} placeholder="Jane Doe" />
            <Field label="Email" value={email} onChange={setEmail} placeholder="you@academy.com" email />
            <View>
              <Label>Password</Label>
              <View style={{ marginTop: 6 }}>
                <TextField value={password} onChangeText={setPassword} placeholder="At least 8 characters" isPassword editable={!saving} />
              </View>
            </View>
            <Field label="Sport" value={sport} onChange={setSport} placeholder="Football" />
            <Field label="Position (optional)" value={position} onChange={setPosition} placeholder="Striker" />
            {error ? <Banner kind="error">{error}</Banner> : null}
            <PrimaryButton label="Create account" onPress={submit} loading={saving} accent={theme.accent} accentInk={theme.accentInk} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, email }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; email?: boolean }) {
  return (
    <View>
      <Label>{label}</Label>
      <View style={{ marginTop: 6 }}>
        <TextField value={value} onChangeText={onChange} placeholder={placeholder} autoCapitalize={email ? "none" : "words"} autoCorrect={false} keyboardType={email ? "email-address" : "default"} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 24, paddingTop: 16, paddingBottom: 32 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 20 },
  backText: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.inkFaint },
});
