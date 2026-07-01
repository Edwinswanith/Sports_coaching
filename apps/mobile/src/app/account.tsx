import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { changePassword } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_THEMES, colors, type RoleTheme } from "../lib/theme";
import { Banner, Card, Label, Muted, PrimaryButton, TextField } from "../components/ui";

export default function Account() {
  const router = useRouter();
  const { user, setUser, signOut } = useAuth();
  const theme: RoleTheme = ROLE_THEMES[(user?.role as keyof typeof ROLE_THEMES) ?? "coach"] ?? ROLE_THEMES.coach;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const localError = useMemo(() => {
    if (next && next.length < 8) return "New password must be at least 8 characters.";
    if (confirm && next !== confirm) return "Passwords don’t match.";
    return null;
  }, [next, confirm]);

  async function save() {
    setMsg(null);
    if (!current || !next || !confirm) {
      setMsg({ kind: "error", text: "Fill in all three fields." });
      return false;
    }
    if (localError) {
      setMsg({ kind: "error", text: localError });
      return false;
    }
    setSaving(true);
    const res = await changePassword(current, next);
    setSaving(false);
    if (res.ok) {
      setUser(res.user);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ kind: "ok", text: "Password updated. Use it next time you sign in." });
      return true;
    }
    if (res.status === 401) setMsg({ kind: "error", text: "Your current password is incorrect." });
    else if (res.error === "weak_password") setMsg({ kind: "error", text: "New password must be at least 8 characters." });
    else if (res.error === "same_password") setMsg({ kind: "error", text: "New password must be different from the current one." });
    else setMsg({ kind: "error", text: "Couldn’t update password. Try again." });
    return false;
  }

  async function onSignOut() {
    await signOut();
    router.replace("/");
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
            <Ionicons name="arrow-back" size={18} color={colors.inkFaint} />
            <Text style={styles.backText}>BACK</Text>
          </Pressable>

          <Text style={styles.title}>Account</Text>

          <Card style={{ marginTop: 12, gap: 4 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Muted>{user?.email}</Muted>
            <View style={[styles.roleChip, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.roleText, { color: theme.accentStrong }]}>{theme.label}</Text>
            </View>
          </Card>

          <Text style={styles.section}>Change password</Text>
          <Card style={{ gap: 14 }}>
            <View>
              <Label>Current password</Label>
              <View style={{ marginTop: 6 }}>
                <TextField value={current} onChangeText={setCurrent} isPassword placeholder="••••••••" editable={!saving} />
              </View>
            </View>
            <View>
              <Label>New password</Label>
              <View style={{ marginTop: 6 }}>
                <TextField value={next} onChangeText={setNext} isPassword placeholder="At least 8 characters" editable={!saving} />
              </View>
            </View>
            <View>
              <Label>Confirm new password</Label>
              <View style={{ marginTop: 6 }}>
                <TextField value={confirm} onChangeText={setConfirm} isPassword placeholder="Re-enter new password" editable={!saving} />
              </View>
            </View>

            {localError ? <Text style={styles.localErr}>{localError}</Text> : null}
            {msg ? <Banner kind={msg.kind}>{msg.text}</Banner> : null}

            <PrimaryButton
              label="Update password"
              onPress={save}
              loading={saving}
              successLabel="Updated"
              accent={theme.accent}
              accentInk={theme.accentInk}
            />
          </Card>

          <Pressable onPress={onSignOut} style={styles.signOut}>
            <Ionicons name="log-out-outline" size={18} color={colors.bad} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 16, paddingBottom: 32 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
  backText: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.inkFaint },
  title: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  name: { fontSize: 18, fontWeight: "700", color: colors.ink },
  roleChip: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
  roleText: { fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  section: { fontSize: 12, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 1, marginTop: 22, marginBottom: 10 },
  localErr: { fontSize: 12, color: colors.bad },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 24, paddingVertical: 12 },
  signOutText: { fontSize: 15, fontWeight: "700", color: colors.bad },
});
