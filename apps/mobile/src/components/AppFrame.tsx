import { ReactNode, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./AppText";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "../lib/api";
import { ROLE_THEMES, colors, radius, type RoleTheme } from "../lib/theme";
import type { Role } from "../lib/roles";
import { ProfileMenu } from "./ProfileMenu";

export type NativeNavItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: number;
};

export function AppFrame({
  role,
  title,
  subtitle,
  nav,
  activeKey,
  onNavigate,
  headerAction,
  renderHeader,
  children,
}: {
  role: Role;
  title: string;
  subtitle?: string;
  nav: NativeNavItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  headerAction?: ReactNode;
  renderHeader?: (ctx: { theme: RoleTheme; unread: number; openNotifications: () => void }) => ReactNode;
  children: ReactNode;
}) {
  const theme = ROLE_THEMES[role];
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const insets = useSafeAreaInsets();
  const openNotifications = () => router.push("/notifications" as never);

  useEffect(() => {
    let active = true;
    apiJson<{ unreadCount: number }>("/api/notifications/unread-count")
      .then((r) => active && setUnread(r.unreadCount))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {renderHeader ? (
        renderHeader({ theme, unread, openNotifications })
      ) : (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.role, { color: theme.accentStrong }]}>{theme.label}</Text>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          <View style={styles.headerActions}>
            {headerAction}
            <IconButton icon="notifications-outline" onPress={openNotifications} theme={theme} badge={unread} />
            <ProfileMenu theme={theme} />
          </View>
        </View>
      )}

      <View style={styles.body}>{children}</View>

      <View style={[styles.tabBar, { paddingBottom: Math.max(8, insets.bottom + 8) }]}>
        {nav.map((item) => {
          const active = item.key === activeKey;
          return (
            <Pressable
              key={item.key}
              onPress={() => onNavigate(item.key)}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.tabIconWrap, active ? { backgroundColor: theme.accentSoft } : null]}>
                <Ionicons name={item.icon} size={18} color={active ? theme.accentStrong : colors.inkFaint} />
                {item.badge ? (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{item.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tabText, active ? { color: theme.accentStrong } : null]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function IconButton({
  icon,
  onPress,
  theme,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  theme: RoleTheme;
  badge?: number;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed ? { opacity: 0.82 } : null]}>
      <Ionicons name={icon} size={20} color={colors.inkMuted} />
      {badge ? <View style={[styles.dot, { backgroundColor: theme.role === "athlete" ? colors.bad : theme.accent }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: "rgba(246,247,243,0.96)",
  },
  headerLeft: { flex: 1, minWidth: 0 },
  role: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 2.2 },
  title: { marginTop: 2, fontSize: 19, fontWeight: "800", color: colors.ink },
  subtitle: { marginTop: 1, fontSize: 11, color: colors.inkFaint },
  headerActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, flexShrink: 0 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { position: "absolute", top: 7, right: 7, height: 10, width: 10, borderRadius: 5 },
  body: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 4,
    marginHorizontal: 10,
    marginBottom: 6,
    paddingTop: 6,
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.97)",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 1, minHeight: 48 },
  tabIconWrap: {
    position: "relative",
    height: 30,
    minWidth: 48,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tabText: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.inkFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  tabBadge: {
    position: "absolute",
    top: -2,
    right: 3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.bad,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  tabBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
});
