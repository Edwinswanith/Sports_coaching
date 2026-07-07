"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "../../../../components/ui";
import { AppShell } from "../../../../components/AppShell";
import { MessageThread } from "../../../../components/MessageThread";
import { coachNav, coachNavigate } from "../../../../lib/coachNav";
import {
  apiFetch,
  clearSession,
  getStoredUser,
  isAuthFailure,
  logout as apiLogout,
  type StoredUser,
} from "../../../../lib/api";

export default function CoachChatPage() {
  const router = useRouter();
  const params = useParams<{ athleteId: string }>();
  const athleteId = params?.athleteId as string;
  const [user, setUser] = useState<StoredUser | null>(null);
  const [partyName, setPartyName] = useState<string>("");

  function authGuard(httpStatus: number): boolean {
    if (isAuthFailure(httpStatus)) {
      clearSession();
      router.replace("/");
      return true;
    }
    return false;
  }

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/");
      return;
    }
    setUser(stored);
    // Resolve the athlete's name from the roster for the header.
    void apiFetch("/api/coach/athletes").then(async (res) => {
      if (authGuard(res.status)) return;
      if (!res.ok) return;
      const json = (await res.json().catch(() => ({}))) as {
        athletes?: { athleteId: string; name: string }[];
      };
      const found = json.athletes?.find((a) => a.athleteId === athleteId);
      if (found) setPartyName(found.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, athleteId]);

  async function logout() {
    await apiLogout();
    router.replace("/");
  }

  const nav = coachNav(user?.isAcademyOwner);
  const navigate = (key: string) => coachNavigate(router, key);

  if (!user) return null;

  return (
    <AppShell
      role="coach"
      title={partyName || "Conversation"}
      subtitle="Direct message"
      userName={undefined}
      nav={nav}
      activeKey="messages"
      onNavigate={navigate}
      onSignOut={logout}
      headerActions={
        <button
          onClick={() => router.push("/coach/messages")}
          aria-label="Back to messages"
          className="btn-ghost h-9 w-9 px-0"
        >
          <Icon.arrowLeft />
        </button>
      }
    >
      <MessageThread base={`/api/coach/athletes/${athleteId}/messages`} role="coach" onAuthFailure={authGuard} />
    </AppShell>
  );
}
