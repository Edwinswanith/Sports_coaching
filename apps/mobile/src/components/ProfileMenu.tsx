import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import { colors, radius, type RoleTheme } from "../lib/theme";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ProfileMenu({ theme }: { theme: RoleTheme }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const name = user?.name || "Your account";
  const email = user?.email ?? "";
  const initials = useMemo(() => initialsOf(name || email), [name, email]);

  async function onSignOut() {
    setOpen(false);
    await signOut();
    router.replace("/");
  }

  function openAccount() {
    setOpen(false);
    router.push("/account" as never);
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={({ pressed }) => [
          styles.avatarButton,
          { backgroundColor: theme.accentSoft, borderColor: theme.accent },
          pressed ? { opacity: 0.82 } : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Profile and account"
      >
        <Text style={[styles.avatarText, { color: theme.accentStrong }]} numberOfLines={1}>
          {initials}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.menu, { top: Math.max(insets.top + 54, 64) }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.identityRow}>
              <View style={[styles.menuAvatar, { backgroundColor: theme.accentSoft }]}>
                <Text style={[styles.menuAvatarText, { color: theme.accentStrong }]}>{initials}</Text>
              </View>
              <View style={styles.identityText}>
                <Text style={styles.name} numberOfLines={1}>
                  {name}
                </Text>
                {email ? (
                  <Text style={styles.email} numberOfLines={1}>
                    {email}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={[styles.roleChip, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.roleText, { color: theme.accentStrong }]}>{theme.label}</Text>
            </View>

            <View style={styles.divider} />

            <Pressable onPress={openAccount} style={styles.menuItem} accessibilityRole="button">
              <Ionicons name="key-outline" size={18} color={colors.inkMuted} />
              <Text style={styles.menuItemText}>Account</Text>
            </Pressable>
            <Pressable onPress={onSignOut} style={styles.menuItem} accessibilityRole="button">
              <Ionicons name="log-out-outline" size={18} color={colors.bad} />
              <Text style={[styles.menuItemText, { color: colors.bad }]}>Sign out</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  avatarButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 12, fontWeight: "900" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(18,24,22,0.18)",
  },
  menu: {
    position: "absolute",
    right: 14,
    width: 264,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  menuAvatar: {
    height: 42,
    width: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  menuAvatarText: { fontSize: 13, fontWeight: "900" },
  identityText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: "800", color: colors.ink },
  email: { marginTop: 2, fontSize: 11, color: colors.inkMuted },
  roleChip: { alignSelf: "flex-start", marginTop: 10, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  roleText: { fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 10 },
  menuItem: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radius.sm, paddingHorizontal: 8 },
  menuItemText: { fontSize: 14, fontWeight: "700", color: colors.ink },
});
