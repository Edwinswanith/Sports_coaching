import { Stack } from "expo-router";
import { colors } from "../../lib/theme";
import { AthleteAskAgentOverlay } from "../../components/RoleAskAgentOverlays";

export default function AthleteLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
      <AthleteAskAgentOverlay />
    </>
  );
}
